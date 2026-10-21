import { useState, useCallback, useRef, Dispatch, SetStateAction } from 'react';
import { Message } from '../../types';
import { getAuthToken, clearAuthToken } from '../../utils/authToken';
import { fetchWithRetry } from '../../utils/fetchRetry';

/**
 * Hook responsible for managing workstream messages state, per-workstream cache isolation,
 * race-condition prevention during workstream switching, and message ordering.
 */
export interface UseWorkstreamMessagesOptions {
  /** The app-level message store. When given, this hook reads and writes it instead of a private copy. */
  messages?: Message[];
  setMessages?: Dispatch<SetStateAction<Message[]>>;
  /** Used as the sender of optimistic messages so they render on the sender's side immediately. */
  currentUserId?: string;
  /** Active order ID for the workstream currently on screen. Takes priority over fetch cache refs. */
  activeOrderId?: string;
}

export function useWorkstreamMessages(options: UseWorkstreamMessagesOptions = {}) {
  // The workspace renders the app-level store, so fetch / send / events must write to that same store.
  // (A private copy here meant fetched history and optimistic sends never reached the screen.)
  const [ownMessages, setOwnMessages] = useState<Message[]>([]);
  const messages = options.messages ?? ownMessages;
  const setMessages = options.setMessages ?? setOwnMessages;
  const currentUserIdRef = useRef<string | undefined>(options.currentUserId);
  currentUserIdRef.current = options.currentUserId;
  const activeOrderIdRef = useRef<string | undefined>(options.activeOrderId);
  activeOrderIdRef.current = options.activeOrderId;
  const [newMessageText, setNewMessageText] = useState('');
  
  // Guard against out-of-order responses when user rapidly switches workstreams
  const activeFetchOrderIdRef = useRef<string | null>(null);

  const fetchMessages = useCallback(async (orderId: string) => {
    if (!orderId) return;
    activeFetchOrderIdRef.current = orderId;

    try {
      const res = await fetchWithRetry(`/api/messages/${orderId}`);

      if (res.status === 401) {
        // Token has expired or is invalid; clear stale credentials cleanly
        clearAuthToken();
        return;
      }

      // Check race condition: if user switched to another workstream while fetch was in flight, ignore
      if (activeFetchOrderIdRef.current !== orderId) {
        return;
      }

      const data = res.ok ? await res.json() : [];
      const newOrderMessages: Message[] = Array.isArray(data) ? data : [];

      // Isolated cache merge: preserve all messages for other workstreams, update this order's messages
      setMessages(prev => {
        const otherMessages = prev.filter(m => m.orderId !== orderId);
        const byId = new Map<string, Message>();
        for (const m of [...otherMessages, ...newOrderMessages]) {
          if (m?.id) {
            byId.set(m.id, m);
          }
        }
        const combined = Array.from(byId.values());
        return combined.sort((a, b) => {
          const tA = a.timestamp ? new Date(a.timestamp).getTime() : NaN;
          const tB = b.timestamp ? new Date(b.timestamp).getTime() : NaN;
          const validA = !isNaN(tA);
          const validB = !isNaN(tB);
          if (!validA && !validB) return 0;
          if (!validA) return 1;
          if (!validB) return -1;
          return tA - tB;
        });
      });
    } catch (err) {
      console.error('Error fetching messages:', err);
    }
  }, []);

  const sendMessage = useCallback(async (text: string, type: string = 'text', fileInfo?: any, targetOrderId?: string) => {
    const activeOrderId = targetOrderId || activeOrderIdRef.current || activeFetchOrderIdRef.current;
    if (!activeOrderId || !text.trim()) return;

    const clientMessageId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);

    const tempMessage: Message = {
      id: clientMessageId,
      orderId: activeOrderId,
      senderId: currentUserIdRef.current || 'current_user',
      senderName: 'You',
      text: text.trim(),
      timestamp: new Date().toISOString(),
      type: type as any,
      fileInfo,
      status: 'sending',
      metadata: { clientMessageId }
    };

    // Optimistic update
    setMessages(prev => [...prev, tempMessage]);
    setNewMessageText('');

    const attemptSend = async () => {
      try {
        const res = await fetchWithRetry(`/api/orders/${activeOrderId}/message`, {
          method: 'POST',
          body: JSON.stringify({
            text: text.trim(),
            type,
            fileInfo,
            clientMessageId
          })
        });

        if (res.ok) {
          const data = await res.json();
          const serverMsg = data.message || data;
          setMessages(prev => prev.map(m => m.id === clientMessageId ? { ...m, ...serverMsg, status: 'sent' } : m));
        } else {
          throw new Error('Server error');
        }
      } catch (err) {
        console.error('Error sending message:', err);
        setMessages(prev => prev.map(m => m.id === clientMessageId ? { ...m, status: 'failed' } : m));
      }
    };

    attemptSend();
  }, [setMessages, setNewMessageText]);

  const sendEvent = useCallback(async (
    orderId: string,
    text: string,
    type: 'system' = 'system',
    metadata: Record<string, any>,
    onError: (msg: string) => void
  ) => {
    const clientMessageId = 'evt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);

    const tempMessage: Message = {
      id: clientMessageId,
      orderId,
      senderId: currentUserIdRef.current || 'current_user',
      senderName: 'System',
      text,
      timestamp: new Date().toISOString(),
      type,
      status: 'sending',
      metadata: { ...metadata, clientMessageId }
    };

    setMessages(prev => [...prev, tempMessage]);

    const sendToServer = async () => {
      try {
        const res = await fetchWithRetry(`/api/orders/${orderId}/message`, {
          method: 'POST',
          body: JSON.stringify({
            text,
            type,
            metadata: { ...metadata, clientMessageId }
          })
        });

        if (res.ok) {
          const data = await res.json();
          setMessages(prev => prev.map(m => m.id === clientMessageId ? { ...data.message, status: 'sent' } : m));
        } else {
          throw new Error('Failed to send event');
        }
      } catch (err) {
        console.error('Event sending failed:', err);
        setMessages(prev => prev.map(m => m.id === clientMessageId ? { ...m, status: 'failed' } : m));
        onError(`Failed to log event: ${text}`);
      }
    };

    sendToServer();
  }, [setMessages]);

  const retryMessage = useCallback(async (msg: Message) => {
    if (!msg || !msg.orderId) return;
    const clientMessageId = msg.metadata?.clientMessageId || msg.id;

    // Optimistically update failed message state back to sending
    setMessages(prev => prev.map(m => (m.id === msg.id || m.id === clientMessageId) ? { ...m, status: 'sending' } : m));

    try {
      const res = await fetchWithRetry(`/api/orders/${msg.orderId}/message`, {
        method: 'POST',
        body: JSON.stringify({
          text: msg.text,
          type: msg.type || 'message',
          fileInfo: msg.fileInfo,
          clientMessageId
        })
      });

      if (res.ok) {
        const data = await res.json();
        const serverMsg = data.message || data;
        setMessages(prev => prev.map(m => (m.id === msg.id || m.id === clientMessageId) ? { ...m, ...serverMsg, status: 'sent' } : m));
      } else {
        throw new Error('Server error');
      }
    } catch (err) {
      console.error('Error retrying message:', err);
      setMessages(prev => prev.map(m => (m.id === msg.id || m.id === clientMessageId) ? { ...m, status: 'failed' } : m));
    }
  }, [setMessages]);

  return {
    messages,
    setMessages,
    newMessageText,
    setNewMessageText,
    fetchMessages,
    sendMessage,
    retryMessage,
    sendEvent
  };
}
