import { useMemo } from 'react';
import { SharedFileItem } from '../../components/workstream/types';
import { Message, Order } from '../../types';

export interface UseWorkstreamFilesProps {
  selectedOrder?: (Order & { deliverableFiles?: Array<any>; deliveries?: Array<any> }) | null;
  messages?: Message[];
}

/**
 * Hook responsible for deriving active shared files from workstream messages,
 * deliverable files, and revision submissions with file classifications and deduplication.
 */
export function useWorkstreamFiles({
  selectedOrder,
  messages = []
}: UseWorkstreamFilesProps = {}) {
  const activeSharedFiles: SharedFileItem[] = useMemo(() => {
    if (!selectedOrder) return [];
    const filesMap = new Map<string, SharedFileItem>();

    // 1. Files from Order deliverableFiles / deliveries
    if (Array.isArray(selectedOrder.deliverableFiles)) {
      selectedOrder.deliverableFiles.forEach((f: any, idx: number) => {
        const id = f.id || `order_deliv_${idx}`;
        const key = f.url && f.url !== '#' ? f.url : f.name;
        filesMap.set(key, {
          id,
          name: f.name || 'Deliverable File',
          size: f.size || '3.5 MB',
          url: f.url || '#',
          uploadedAt: f.uploadedAt || selectedOrder.createdAt,
          uploadedBy: 'Seller',
          type: f.category || 'deliverable'
        });
      });
    }

    const deliveryRecords = Array.isArray((selectedOrder as any).deliveryHistory) 
      ? (selectedOrder as any).deliveryHistory 
      : (Array.isArray(selectedOrder.deliveries) ? selectedOrder.deliveries : []);

    if (deliveryRecords.length > 0) {
      deliveryRecords.forEach((d: any) => {
        if (Array.isArray(d.files)) {
          d.files.forEach((f: any, fIdx: number) => {
            const key = f.url && f.url !== '#' ? f.url : `${d.version}_${f.name}`;
            if (!filesMap.has(key)) {
              filesMap.set(key, {
                id: f.id || `deliv_v${d.version}_${fIdx}`,
                name: f.name || `Deliverable v${d.version}`,
                size: f.size || '1.0 MB',
                url: f.url || '#',
                uploadedAt: d.deliveredAt ? new Date(d.deliveredAt).toLocaleDateString() : (d.submittedAt ? new Date(d.submittedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : selectedOrder.createdAt),
                uploadedBy: 'Seller',
                type: 'deliverable'
              });
            }
          });
        }
      });
    }

    // 2. Files attached in Messages or Deliverable Submitted System Events
    messages
      .filter(m => m.orderId === selectedOrder.id)
      .forEach(m => {
        if (Array.isArray(m.metadata?.files)) {
          m.metadata.files.forEach((f: any, idx: number) => {
            if (!f) return;
            const key = f.url && f.url !== '#' ? f.url : `msg_deliv_${m.id}_${f.name || idx}`;
            if (!filesMap.has(key)) {
              filesMap.set(key, {
                id: f.id || `${m.id}_file_${idx}`,
                name: f.name || 'Deliverable File',
                size: f.size || '1.0 MB',
                url: f.url || '#',
                uploadedAt: m.timestamp,
                uploadedBy: 'Seller',
                type: 'deliverable'
              });
            }
          });
        }
        const fileInfo = m.fileInfo;
        if (!fileInfo) return;
        const key = fileInfo.url && fileInfo.url !== '#' ? fileInfo.url : fileInfo.name;
        if (!filesMap.has(key)) {
          const isDeliverable = m.type === 'deliverable' || fileInfo.type === 'deliverable' || (fileInfo as any).category === 'deliverable';
          filesMap.set(key, {
            id: m.id,
            name: fileInfo.name || 'attachment.pdf',
            size: fileInfo.size || '1.0 MB',
            url: fileInfo.url || '#',
            uploadedAt: m.timestamp,
            uploadedBy: m.senderName,
            type: isDeliverable ? 'deliverable' : 'attachment'
          });
        }
      });

    return Array.from(filesMap.values());
  }, [selectedOrder, messages]);

  return {
    activeSharedFiles
  };
}
