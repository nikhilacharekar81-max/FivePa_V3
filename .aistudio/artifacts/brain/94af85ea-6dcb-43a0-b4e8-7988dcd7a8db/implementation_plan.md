# Notification & Activity UX Upgrade Plan

## Summary
Upgrade the notification, activity, and Workstream alert experience to be professional, marketplace-oriented, and Fiverr-inspired, while maintaining WorkPerHour branding.

## User Review & Critical Decisions
> [!IMPORTANT]
> The primary design shift is moving from a utilitarian, developer-style notification list to a polished, high-fidelity card-based marketplace notification system.

- **Fiverr-Style UI**: We will focus on concise, high-information-density cards for the Bell dropdown, Activity Stream, and full-page history.
- **Bell Dropdown Behavior**: Bell will be restricted to critical marketplace events, while Workstream/Messages will handle all collaborative conversations.
- **Deduplication Strategy**: We will implement strict deduplication using existing event IDs to prevent notification floods.
- **Realtime Infrastructure**: We will leverage the existing WebSocket infrastructure for realtime events, focusing on event-based UI updates.

## 1. Overview & Core Concept
- **What It Does**: Polishes the notification system, Bell dropdown, and Activity Stream.
- **Target Audience**: Marketplace users (Buyers/Freelancers).
- **Key Value**: Reduced notification noise, improved clarity of important events (hiring, payment, delivery, review), and a more professional user experience.

## 2. User Experience & Visual Design
- **Visual Language**: Green-tinted WorkPerHour branding applied to Fiverr-inspired card structures (icons, titles, descriptions, timestamps).
- **Bell Dropdown**: A focused, high-density dropdown for events like proposals, payment milestones, and order status updates.
- **Activity Stream**: A full-page history of events formatted with the same polished card system, for a complete audit trail.
- **Visual Hierarchy**: Unread states will be distinguished by subtle background and font weight treatments.

## 3. Key Product Decisions & Trade-Offs
- **Decision 1: Separation of Concerns**: Bell = Marketplace Activity, Messages/Workstream = Conversational History. We will strictly separate these to prevent information overload.
- **Decision 2: Deduplication**: We will introduce a deduplication layer based on `eventId` or specific `orderId`/`proposalId`+`eventType` combinations within the API/WebSocket handlers.

## 4. Technical Architecture & Data Strategy
- **WebSocket Refinement**: Ensure event handlers are idempotent.
- **Card Componentization**: A unified `NotificationCard` component will be used for both Bell dropdowns, the Activity Stream, and the Notifications Page.
- **Data Model**: Leverage existing types (types.ts) and add a lightweight event mapper to translate raw database events into notification display objects.

```
┌──────────────────┐      ┌─────────────────────────┐
│ WebSocket Server │────▶ │ Client NotificationStore│
└──────────────────┘      └────────────┬────────────┘
                                       │
            ┌──────────────────────────┴──────────┐
            │       NotificationCard Component    │
            └────────────┬────────────────────────┘
                         │
        ┌────────────────┴────────────────────────┐
        │ Header Bell / Activity Stream / Page    │
        └─────────────────────────────────────────┘
```
