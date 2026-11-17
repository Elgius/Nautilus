# Nautilus feature map

Nautilus organizes people, agents, documents, and tasks into rooms within an organization. The [web app](apps/web/app) provides the workspace, the [Worker API](apps/server/src/index.ts) checks access and coordinates room work, and the [private Office service](apps/office/src/app.ts) converts and edits Word and Excel content.

## Workspace

| Feature | What users can do | Implementation |
| --- | --- | --- |
| Accounts and organizations | Sign in, verify email, reset a password, switch organizations, and invite members. | [Account screens](apps/web/components/auth) · [Authentication](apps/server/src/auth.ts) |
| Rooms | Find, create, and star rooms, set a room goal, and assign agents. Organization membership grants room access. | [Workspace](apps/web/components/workspace/workspace.tsx) · [Room API](apps/server/src/rooms.ts) |
| Activity and settings | View the current session’s activity, change the theme, and manage the workspace name. | [Workspace views](apps/web/components/workspace/workspace.tsx) · [Theme settings](apps/web/components/theme-settings.tsx) |
| Agent profiles | Create an agent from a description, customize its rules and appearance, and generate an avatar. | [Agent controls](apps/web/components/agents) · [Profile creation](apps/server/src/agent-creator.ts) · [Avatar generation](apps/server/src/avatar-generation.ts) |
| Agent Hub conversations | Start private chats with an agent and reopen completed exchanges on any device when signed in to the same account and organization. Browse pages of chat previews and open a conversation to load its transcript. Refreshing keeps the selected chat and draft. Switching accounts requires reloading the workspace, and retrying the same in-flight message avoids a second model call. Opening the hub imports previously saved browser chats. | [Agent Hub](apps/web/components/agents/agent-hub.tsx) · [Chat API](apps/server/src/agent-chat.ts) · [Postgres history](apps/server/src/hub-history.ts) |
| Document library | Search saved documents by title or room name and open the owning room. | [Library view](apps/web/components/workspace/room-document-library.tsx) · [Library API](apps/server/src/document-library.ts) |
| Kanban and Calendar | View the same room tasks by status or date. Tasks support assignments, due dates, and revision-checked edits. | [Planner UI](apps/web/components/workspace/planner.tsx) · [Task API](apps/server/src/planner/routes.ts) |
| Knowledge | Tag saved documents or individual chat messages for personal or organization knowledge. Refresh findings and inspect their source history. | [Knowledge view](apps/web/components/knowledge/knowledge-base.tsx) · [Knowledge API and worker](apps/server/src/knowledge) |

## Inside a room

| Feature | What users can do | Implementation |
| --- | --- | --- |
| Shared chat | Exchange room messages in real time, load earlier messages, and request suggestions. | [Chat client](apps/web/components/room/use-room-chat.ts) · [Room chat Durable Object](apps/server/src/room-chat.ts) · [Suggestions](apps/server/src/room-suggestions.ts) |
| Private agent conversations | Work privately with an assigned agent. The room moderator can delegate to specialists and submit proposed document or task changes for review. | [Conversation UI](apps/web/components/room/private-agent-conversation.tsx) · [Moderator](apps/server/src/room-moderator.ts) · [Edit review](apps/server/src/edit-review.ts) |
| Local files and saved attachments | Pick or drop files for browser-local preview and download. The picker retains the original files in memory. An explicit save stores the original as a room attachment, separate from document versions. | [Local file state](apps/web/lib/local-room-files.ts) · [Room file controls](apps/web/components/room/room-documents.tsx) · [Attachment API](apps/server/src/room-attachments.ts) |
| Documents and spreadsheets | Create and edit rich text or spreadsheets, save a version, and inspect history. Postgres tracks versions and S3 holds their snapshots. | [Editors](apps/web/components/room/univer-editor-core.tsx) · [History](apps/web/components/room/document-history.tsx) · [Version persistence](apps/server/src/documents/document-service.ts) |
| Office import and export | Import Word or spreadsheet content into an editor draft, then save explicitly. Export the current draft as DOCX or XLSX. | [Room API](apps/server/src/rooms.ts) · [Office service](apps/office/src/app.ts) |

## Agent tools

| Capability | Behavior | Implementation |
| --- | --- | --- |
| Document work | Read saved snapshots, create documents, and apply reviewed edits. A room write lock coordinates agent work with manual changes. | [Room skills](apps/server/src/agent_interface/room-skills.ts) · [Write lock](apps/server/src/documents/room-write-lock.ts) · [Office editing operations](apps/office/src/editing) |
| Task management | Read and update room tasks through the moderator. Specialists can propose updates for the moderator to accept. | [Planner tools](apps/server/src/planner/skill.ts) · [Planner contract](skills/planner.md) |
| Scheduled work | Schedule, reschedule, or cancel a one-time instruction for assigned room agents. Running work at a future time requires an explicit schedule, even when a task has a due date. | [Scheduler](apps/server/src/scheduler) · [Delivery contract](skills/scheduler.md) |
| Progress notes | Save objectives, completed work, blockers, and document references for a later conversation with the same user and agent in the room. | [Progress tools](apps/server/src/progress/skill.ts) · [Progress contract](skills/progress.md) |
