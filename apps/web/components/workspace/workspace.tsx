"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { type Room } from "@/lib/room-data";
import { roomRequest, toRoom, type RoomRecord } from "@/lib/room-client";
import { type Agent, type AgentProfile } from "@/lib/agent-data";
import { persistAgent } from "@/lib/agent-client";
import { AgentPortrait } from "@/components/agents/agent-portrait";
import { AgentProfileDialog } from "@/components/agents/agent-profile-dialog";
import { CreateAgentDialog } from "@/components/agents/create-agent-dialog";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { RoomDocumentLibrary } from "@/components/workspace/room-document-library";
import "@/app/documents.css";
import { BrandMark } from "@/components/brand-mark";
import { useWorkspaceSession } from "@/components/auth/workspace-session";
import { InviteMembers } from "@/components/auth/invite-members";
import { authClient, checkAuthResult, errorMessage } from "@/lib/auth-client";
import { canManageOrganization, initials } from "@/lib/auth-types";
import {
  Activity,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  Bot,
  Check,
  ChevronRight,
  Command,
  FileText,
  Folder,
  LayoutGrid,
  List,
  MessageSquare,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Table2,
  Users,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { AppSidebar, type WorkspaceView } from "@/components/app-sidebar";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

type View = WorkspaceView;
type Event = {
  agent: string;
  action: string;
  target: string;
  time: string;
  icon: "check" | "message" | "join";
};
const navigation: { label: View; icon: LucideIcon }[] = [
  { label: "Overview", icon: LayoutGrid },
  { label: "Rooms", icon: MessageSquare },
  { label: "Agents", icon: Bot },
  { label: "Documents", icon: FileText },
  { label: "Knowledge", icon: BookOpen },
  { label: "Activity", icon: Activity },
];

function AgentAvatar({
  name,
  agents,
  small = false,
}: {
  name: string;
  agents: Agent[];
  small?: boolean;
}) {
  const agent = agents.find((item) => item.name === name);
  return <AgentPortrait agent={agent} small={small} />;
}
function Status({ status }: { status: Room["status"] }) {
  return (
    <span
      className={`room-status ${status.toLowerCase().replaceAll(" ", "-")}`}
    >
      <i />
      {status}
    </span>
  );
}

export function Workspace({ initialAgents, initialRooms }: { initialAgents: Agent[]; initialRooms: Room[] }) {
  const router = useRouter();
  const { session, refresh } = useWorkspaceSession();
  const workspaceName = session.activeOrganization?.name || "Workspace";
  const membership = session.memberships.find(
    (member) => member.organizationId === session.activeOrganization?.id,
  );
  const canManage = canManageOrganization(membership?.role);
  const [savingSettings, setSavingSettings] = useState(false);
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [starringRooms, setStarringRooms] = useState<string[]>([]);
  const [view, setView] = useState<View>("Overview");
  const [rooms, setRooms] = useState(initialRooms);
  const [agents, setAgents] = useState(initialAgents);
  const [events, setEvents] = useState<Event[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All rooms");
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [modal, setModal] = useState<
    "room" | "agent" | "invite" | "help" | "notifications" | null
  >(null);
  const [notice, setNotice] = useState("");
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const editingAgent = agents.find((agent) => agent.id === editingAgentId);
  const [selectedAgents, setSelectedAgents] = useState<string[]>(initialAgents[0] ? [initialAgents[0].id] : []);
  const visibleRooms = rooms.filter(
    (room) =>
      (filter !== "Starred" || room.favorite) &&
      (filter !== "Needs review" || room.status === "Needs review") &&
      `${room.name} ${room.description} ${room.category}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const workingAgents = agents.filter(
    (agent) => agent.status === "Working",
  ).length;
  function navigate(next: View) {
    setView(next);
    setSearch("");
  }
  function addEvent(agent: string, action: string, target: string) {
    setEvents((previous) => [
      { agent, action, target, time: "Just now", icon: "join" },
      ...previous,
    ]);
  }
  async function createRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creatingRoom || !session.activeOrganization) return;
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name")).trim();
    if (!name) return;
    setCreatingRoom(true);
    setNotice("");
    try {
      const { room } = await roomRequest<{ room: RoomRecord }>(session.activeOrganization.id, '', 'POST', {
        name, description: String(data.get('description')).trim(), category: String(data.get('category')), agentIds: selectedAgents,
      });
      setRooms((previous) => [toRoom(room), ...previous]);
      addEvent("You", "created", name);
      setModal(null);
      setView("Rooms");
      setFilter("All rooms");
      setSearch("");
      setSelectedAgents(agents[0] ? [agents[0].id] : []);
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setCreatingRoom(false);
    }
  }
  async function starRoom(room: Room) {
    if (!session.activeOrganization || starringRooms.includes(room.id)) return;
    setStarringRooms((previous) => [...previous, room.id]);
    try {
      const { starred } = await roomRequest<{ starred: boolean }>(session.activeOrganization.id, `/${encodeURIComponent(room.id)}/star`, 'POST', { starred: !room.favorite });
      setRooms((previous) => previous.map((item) => item.id === room.id ? { ...item, favorite: starred } : item));
    } catch (error) { setNotice(errorMessage(error)); }
    finally { setStarringRooms((previous) => previous.filter((id) => id !== room.id)); }
  }
  async function createAgent(profile: AgentProfile): Promise<string | null> {
    if (!session.activeOrganization) return "Choose an organisation first.";
    if (agents.some((agent) => agent.name.toLowerCase() === profile.name.toLowerCase())) {
      return "An agent with that name already exists.";
    }
    try {
      const agent = await persistAgent(session.activeOrganization.id, profile);
      setAgents((previous) => [...previous, agent]);
      addEvent("You", "added agent", agent.name);
      setModal(null);
      setNotice("");
      setView("Agents");
      setEditingAgentId(agent.id);
      return null;
    } catch (error) {
      return errorMessage(error);
    }
  }
  async function saveAgent(agentId: string, oldName: string, profile: AgentProfile): Promise<string | null> {
    const name = profile.name.trim();
    if (!name) return "Enter a name for your agent.";
    if (
      agents.some(
        (agent) =>
          agent.name !== oldName &&
          agent.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      return "Choose a name that isn’t already used by another agent.";
    }
    if (!session.activeOrganization) return "Choose an organisation first.";
    let saved: Agent;
    try {
      saved = await persistAgent(session.activeOrganization.id, { ...profile, name }, agentId);
    } catch (error) {
      return errorMessage(error);
    }
    const replaceName = (current: string) =>
      current === oldName ? name : current;
    setAgents((previous) =>
      previous.map((agent) =>
        agent.id === agentId
          ? saved
          : agent,
      ),
    );
    setRooms((previous) =>
      previous.map((room) => ({
        ...room,
        agents: room.agents.map(replaceName),
      })),
    );
    setEvents((previous) =>
      previous.map((item) => ({
        ...item,
        agent: replaceName(item.agent),
        target:
          item.action === "added agent"
            ? replaceName(item.target)
            : item.target,
      })),
    );
    setNotice(`${name}’s profile saved.`);
    return null;
  }
  function openRoom(room: Room) {
    router.push(`/room-id=${encodeURIComponent(room.id)}`);
  }
  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || !session.activeOrganization) return;
    const name = String(
      new FormData(event.currentTarget).get("workspace"),
    ).trim();
    if (!name) return;
    setSavingSettings(true);
    setNotice("");
    try {
      checkAuthResult(
        await authClient.organization.update({
          organizationId: session.activeOrganization.id,
          data: { name },
        }),
      );
      await refresh();
      setNotice("Organisation name updated.");
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setSavingSettings(false);
    }
  }
  return (
    <TooltipProvider>
      <SidebarProvider className="workspace-shell nautilus-sidebar-layout">
        <AppSidebar
          workspaceName={workspaceName}
          view={view}
          navigation={navigation}
          rooms={rooms}
          agentCount={agents.length}
          onNavigate={navigate}
          onOpenRoom={(id) => {
            const room = rooms.find((room) => room.id === id);
            if (room) openRoom(room);
          }}
          onAction={setModal}
        />
        <SidebarInset className="workspace-main">
          <header className="topbar">
            <div className="breadcrumb">
              <SidebarTrigger />
              <span>{workspaceName}</span>
              <ChevronRight size={13} />
              <strong>{view}</strong>
            </div>
            <div className="topbar-actions">
              <span className="demo-label">Sample content</span>
              <Button variant="ghost" size="sm"
                className="notification-button"
                aria-label="View notifications"
                onClick={() => setModal("notifications")}
              >
                <Bell size={18} />
                <i />
              </Button>
              <span
                className="human-avatar top-avatar"
                title={session.user.name}
              >
                {initials(session.user.name)}
              </span>
            </div>
          </header>
          <main className="main-content">
            {view !== "Documents" && (
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    <span /> YOUR TEAM, IN SYNC
                  </div>
                  <h1>
                    {view === "Overview"
                      ? "A little teamwork. A lot of possibility."
                      : view === "Rooms"
                        ? "Where good work comes together."
                        : view === "Agents"
                          ? "Meet your unfair advantage."
                          : view === "Knowledge"
                            ? "Shared context. Smarter teamwork."
                            : view === "Activity"
                              ? "Keep a pulse on your workspace."
                              : "Make this space your own."}
                  </h1>
                  <p>
                    {view === "Overview"
                      ? "Your people and agents, moving work forward. Here’s what’s happening."
                      : view === "Rooms"
                        ? "Bring people, agents, and context together around a shared goal."
                        : view === "Agents"
                          ? "Specialized collaborators, ready to join your team."
                          : view === "Knowledge"
                            ? "Give your agents the context they need to do their best work."
                            : view === "Activity"
                              ? "The latest updates from your people and agents."
                              : "Manage the basics for your team’s home in Agents hub."}
                  </p>
                </div>
                <Button
                  className="primary-action"
                  onClick={() => {
                    setNotice("");
                    setModal(view === "Agents" ? "agent" : "room");
                  }}
                >
                  <Plus size={16} />
                  {view === "Agents" ? "Create agent" : "Create room"}
                </Button>
              </div>
            )}
            {view === "Documents" && <RoomDocumentLibrary rooms={rooms} onOpen={openRoom} />}
            {(view === "Overview" || view === "Rooms") && (
              <>
                {view === "Overview" && (
                  <>
                    <section
                      className="stats-grid"
                      aria-label="Workspace statistics"
                    >
                      {[
                        {
                          label: "Active rooms",
                          value: rooms.length,
                          icon: MessageSquare,
                          detail: "Ideas in motion",
                          color: "green",
                        },
                        {
                          label: "Agents on your team",
                          value: agents.length,
                          icon: Bot,
                          detail: `${workingAgents} working right now`,
                          color: "violet",
                        },
                        {
                          label: "Documents",
                          value: rooms.reduce(
                            (sum, room) => sum + room.documentCount,
                            0,
                          ),
                          icon: Check,
                          detail: "Across your rooms",
                          color: "orange",
                        },
                        {
                          label: "Team members",
                          value: 5,
                          icon: Users,
                          detail: "People behind the progress",
                          color: "blue",
                        },
                      ].map(({ label, value, icon: Icon, detail, color }) => (
                        <div className="stat-card" key={label}>
                          <div>
                            <span>{label}</span>
                            <span className={`stat-icon ${color}`}>
                              <Icon size={17} />
                            </span>
                          </div>
                          <strong>{value.toString().padStart(2, "0")}</strong>
                          <small>{detail}</small>
                        </div>
                      ))}
                    </section>
                  </>
                )}
                <section className="rooms-section">
                  <div className="section-heading">
                    <div>
                      <h2>
                        Your rooms <span>{rooms.length}</span>
                      </h2>
                      <p>Shared spaces. Collective progress.</p>
                    </div>
                    {view === "Overview" && (
                      <Button variant="ghost" size="sm"
                        className="text-link"
                        onClick={() => navigate("Rooms")}
                      >
                        View all rooms <ArrowRight size={14} />
                      </Button>
                    )}
                  </div>
                  <div className="room-toolbar">
                    <div className="room-filters" aria-label="Filter rooms">
                      {["All rooms", "Starred", "Needs review"].map((item) => (
                        <Button variant="ghost" size="sm"
                          key={item}
                          className={filter === item ? "selected" : ""}
                          aria-pressed={filter === item}
                          onClick={() => setFilter(item)}
                        >
                          {item === "Starred" && <Star size={13} />}
                          {item}
                          {item === "Needs review" && (
                            <span>
                              {
                                rooms.filter(
                                  (room) => room.status === "Needs review",
                                ).length
                              }
                            </span>
                          )}
                        </Button>
                      ))}
                    </div>
                    <div className="room-tools">
                      <div className="search-input">
                        <Search size={15} />
                        <Input
                          aria-label="Search rooms"
                          placeholder="Search rooms…"
                          value={search}
                          onChange={(event) => setSearch(event.target.value)}
                        />
                      </div>
                      <div className="layout-toggle">
                        <Button variant="ghost" size="icon-sm"
                          aria-label="Grid view"
                          aria-pressed={layout === "grid"}
                          className={layout === "grid" ? "selected" : ""}
                          onClick={() => setLayout("grid")}
                        >
                          <LayoutGrid size={15} />
                        </Button>
                        <Button variant="ghost" size="icon-sm"
                          aria-label="List view"
                          aria-pressed={layout === "list"}
                          className={layout === "list" ? "selected" : ""}
                          onClick={() => setLayout("list")}
                        >
                          <List size={16} />
                        </Button>
                      </div>
                    </div>
                  </div>
                  <div
                    className={`room-grid ${layout === "list" ? "list-view" : ""}`}
                  >
                    {visibleRooms.map((room) => (
                      <article className="room-card" key={room.id}>
                        <div className="room-card-top">
                          <span className={`room-symbol ${room.color}`}>
                            {room.category === "Engineering" ? (
                              <Command size={21} />
                            ) : room.category === "Research" ? (
                              <Search size={21} />
                            ) : (
                              <Workflow size={21} />
                            )}
                          </span>
                          <div>
                            <Status status={room.status} />
                            <Button variant="ghost" size="sm"
                              className={`star-button ${room.favorite ? "is-starred" : ""}`}
                              onClick={() => starRoom(room)}
                              disabled={starringRooms.includes(room.id)}
                              aria-label={`${room.favorite ? "Unstar" : "Star"} ${room.name}`}
                              aria-pressed={room.favorite}
                            >
                              <Star size={15} />
                            </Button>
                          </div>
                        </div>
                        <Link
                          className="room-title"
                          href={`/room-id=${encodeURIComponent(room.id)}`}
                        >
                          {room.name}
                          <ArrowUpRight size={16} />
                        </Link>
                        <p className="room-description">{room.description}</p>
                        <div
                          className="room-file-types"
                          aria-label="Room file types"
                        >
                          {(
                            room.contentTypes ?? ["document", "spreadsheet"]
                          ).map((type) => (
                            <span key={type}>
                              {type === "spreadsheet" ? (
                                <Table2 size={12} />
                              ) : (
                                <FileText size={12} />
                              )}
                              {type === "spreadsheet"
                                ? "Spreadsheet"
                                : "Document"}
                            </span>
                          ))}
                        </div>
                        <div className="room-agent-tags">
                          {room.agents.map((name) => (
                            <span key={name}>
                              <AgentAvatar name={name} agents={agents} small />
                              {name}
                            </span>
                          ))}
                          <span className="category-tag">{room.category}</span>
                        </div>
                        <div className="room-card-footer">
                          <div className="member-stack">
                            {room.members.map((member) => (
                              <span
                                className={`human-avatar member-${member}`}
                                key={member}
                              >
                                {member}
                              </span>
                            ))}
                          </div>
                          <span>
                            <Check size={13} />
                            {room.documentCount} documents
                          </span>
                          <small>{room.updated}</small>
                        </div>
                      </article>
                    ))}
                  </div>
                  {visibleRooms.length === 0 && (
                    <div className="empty-state">
                      <Search size={25} />
                      <h3>No rooms found</h3>
                      <p>
                        Try another search or create a space for something new.
                      </p>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setSearch("");
                          setFilter("All rooms");
                        }}
                      >
                        Clear filters
                      </Button>
                    </div>
                  )}
                </section>
              </>
            )}
            {view === "Overview" && (
              <div className="bottom-grid">
                <section className="activity-panel">
                  <div className="section-heading">
                    <h2>Recent activity</h2>
                    <Button variant="ghost" size="sm"
                      className="text-link"
                      onClick={() => navigate("Activity")}
                    >
                      View all <ArrowRight size={14} />
                    </Button>
                  </div>
                  <ActivityFeed
                    events={events.slice(0, 3)}
                    onOpen={(name) => {
                      const room = rooms.find((item) => item.name === name);
                      if (room) openRoom(room);
                      else navigate("Agents");
                    }}
                  />
                </section>
                <section className="team-panel">
                  <div className="section-heading">
                    <h2>
                      Your agent team <span>{agents.length}</span>
                    </h2>
                    <Button variant="ghost" size="sm"
                      className="text-link"
                      onClick={() => navigate("Agents")}
                    >
                      Manage <ArrowRight size={14} />
                    </Button>
                  </div>
                  <div className="agent-mini-grid">
                    {agents.slice(0, 4).map((agent) => (
                      <Button variant="ghost" size="sm"
                        type="button"
                        className="agent-mini h-auto justify-start whitespace-normal text-left"
                        key={agent.id}
                        onClick={() => setEditingAgentId(agent.id)}
                      >
                        <AgentAvatar name={agent.name} agents={agents} />
                        <div>
                          <strong>{agent.name}</strong>
                          <small>{agent.role}</small>
                        </div>
                        <span
                          className={`availability ${agent.status.toLowerCase()}`}
                          title={agent.status}
                        />
                      </Button>
                    ))}
                  </div>
                  <div className="team-panel-footer">
                    <span className="status-dot" /> A little more bandwidth. A
                    lot more potential.
                  </div>
                </section>
              </div>
            )}
            {view === "Agents" && (
              <section
                className="agent-directory"
                aria-labelledby="agent-directory-title"
              >
                <div className="section-heading">
                  <div>
                    <h2 id="agent-directory-title">
                      Your agent team <span>{agents.length}</span>
                    </h2>
                    <p className="agent-directory-description">
                      Explore each agent’s role, customize their identity, and
                      set the rules they work by.
                    </p>
                  </div>
                  <Badge variant="outline">
                    {workingAgents} working · {agents.length - workingAgents}{" "}
                    available
                  </Badge>
                </div>
                <Accordion className="agent-accordion" multiple>
                  {agents.map((agent) => {
                    const assignedRooms = rooms.filter((room) =>
                      room.agents.includes(agent.name),
                    );
                    return (
                      <AccordionItem
                        key={agent.id}
                        value={agent.id}
                        className="agent-accordion-item"
                      >
                        <div className="agent-accordion-header">
                          <div className="agent-profile-button">
                            <AgentPortrait agent={agent} />
                            <span>
                              <strong>{agent.name}</strong>
                              <small>{agent.role}</small>
                            </span>
                          </div>
                          <span
                            className={`agent-state ${agent.status.toLowerCase()}`}
                          >
                            <i />
                            {agent.status}
                          </span>
                          <AccordionTrigger
                            className="agent-expand"
                            aria-label={`Toggle ${agent.name} details`}
                          >
                            <span className="sr-only">
                              {agent.name} details
                            </span>
                          </AccordionTrigger>
                        </div>
                        <AccordionContent>
                          <div className="agent-accordion-details">
                            <div>
                              <h3>Agent rules</h3>
                              <p className="agent-rules-summary">
                                {agent.rules.join("\n") ||
                                  "No rules yet. Add instructions to guide this agent."}
                              </p>
                            </div>
                            <div>
                              <h3>
                                Assigned rooms{" "}
                                <span>{assignedRooms.length}</span>
                              </h3>
                              <div className="agent-assigned-rooms">
                                {assignedRooms.length ? (
                                  assignedRooms.map((room) => (
                                    <Button variant="ghost" size="sm"
                                      key={room.id}
                                      onClick={() => openRoom(room)}
                                    >
                                      <MessageSquare size={14} />
                                      {room.name}
                                      <ArrowUpRight size={12} />
                                    </Button>
                                  ))
                                ) : (
                                  <p>No rooms assigned yet.</p>
                                )}
                              </div>
                            </div>
                            <div className="agent-detail-actions">
                              <Button
                                variant="outline"
                                onClick={() => setEditingAgentId(agent.id)}
                              >
                                Customize agent
                              </Button>
                              <Button
                                variant="ghost"
                                onClick={() => {
                                  setSelectedAgents([agent.name]);
                                  setModal("room");
                                }}
                              >
                                <Plus size={14} />
                                Start a room
                              </Button>
                            </div>
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    );
                  })}
                </Accordion>
                <p className="form-note">
                  Agent profiles are saved to your organisation.
                </p>
              </section>
            )}
            {view === "Activity" && (
              <section className="full-panel">
                <div className="section-heading">
                  <h2>Workspace timeline</h2>
                  <Badge variant="outline">
                    Sample activity + this session
                  </Badge>
                </div>
                <ActivityFeed
                  events={events}
                  onOpen={(name) => {
                    const room = rooms.find((item) => item.name === name);
                    if (room) openRoom(room);
                    else navigate("Agents");
                  }}
                />
              </section>
            )}
            {view === "Knowledge" && (
              <section className="knowledge-panel">
                <div className="knowledge-illustration">
                  <BookOpen size={34} />
                  <span>
                    <Sparkles size={16} />
                  </span>
                </div>
                <Badge variant="outline">SHARED KNOWLEDGE</Badge>
                <h2>Good work starts with good context.</h2>
                <p>
                  Room briefs are the first building block of your shared
                  knowledge. Add a clear goal and useful context when creating a
                  room.
                </p>
                <Button onClick={() => setModal("room")}>
                  <Plus size={15} /> Create a room with a brief
                </Button>
                <div className="knowledge-note">
                  <Folder size={17} /> Documents and connected sources are
                  coming next.
                </div>
              </section>
            )}
            {view === "Settings" && (
              <section className="settings-panel">
                <h2>Workspace details</h2>
                <p>The home for your people, agents, and shared work.</p>
                <form onSubmit={saveSettings}>
                  <label htmlFor="workspace-name">Workspace name</label>
                  <Input
                    id="workspace-name"
                    name="workspace"
                    defaultValue={workspaceName}
                    key={workspaceName}
                    disabled={!canManage || savingSettings}
                    required
                    maxLength={48}
                  />
                  <label>Workspace plan</label>
                  <div className="plan-detail">
                    <ShieldCheck size={20} />
                    <div>
                      <strong>Team workspace</strong>
                      <small>Frontend preview · sample data</small>
                    </div>
                  </div>
                  <Button type="submit" disabled={!canManage || savingSettings}>
                    {savingSettings ? "Saving…" : "Save changes"}
                  </Button>
                </form>
              </section>
            )}
            <footer className="page-footer">
              <span>
                <BrandMark className="nautilus-mark small" /> Room to think.
                Power to do.
              </span>
              <span>
                <span className="status-dot" /> Frontend preview
              </span>
            </footer>
          </main>
        </SidebarInset>
        <Dialog
          open={modal !== null && modal !== "agent"}
          onOpenChange={(open) => {
            if (!open && !creatingRoom) {
              setModal(null);
              setNotice("");
            }
          }}
        >
          <DialogContent className="workspace-dialog sm:max-w-lg" showCloseButton={!creatingRoom}>
            <DialogHeader>
              <DialogTitle>
                {modal === "room"
                  ? "Make room for something great."
                  : modal === "invite"
                    ? "Bring your team together."
                    : modal === "notifications"
                      ? "You’re all caught up."
                      : "Welcome to Agents hub."}
              </DialogTitle>
              <DialogDescription>
                {modal === "room"
                  ? "Give your team and agents a shared goal and a place to work."
                  : modal === "invite"
                    ? "Invite a teammate to this organisation. They’ll verify their email before joining."
                    : modal === "notifications"
                      ? "Recent workspace updates appear below. These are sample notifications."
                      : "Your shared workspace for people and AI agents."}
              </DialogDescription>
            </DialogHeader>
            {modal === "room" && (
              <form onSubmit={createRoom} className="dialog-form" aria-busy={creatingRoom}>
                <fieldset disabled={creatingRoom} className="contents">
                <label htmlFor="room-name">Room name</label>
                <Input
                  id="room-name"
                  name="name"
                  placeholder="e.g. Our next big launch"
                  maxLength={70}
                  required
                  autoFocus
                />
                <label htmlFor="room-description">
                  What are we working toward?
                </label>
                <Textarea
                  id="room-description"
                  name="description"
                  placeholder="Share the goal, context, and what success looks like…"
                  maxLength={600}
                />
                <label htmlFor="room-category">Team</label>
                <Select name="category" defaultValue="General" disabled={creatingRoom}
                  items={["General", "Marketing", "Research", "Engineering", "Operations"].map((value) => ({ value, label: value }))}>
                  <SelectTrigger id="room-category" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["General", "Marketing", "Research", "Engineering", "Operations"].map((category) => (
                      <SelectItem key={category} value={category}>{category}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <label>Add agents</label>
                <div className="agent-choices">
                  {agents.map((agent) => (
                    <Button variant="ghost" size="sm"
                      className={
                        selectedAgents.includes(agent.id) ? "chosen" : ""
                      }
                      type="button"
                      aria-pressed={selectedAgents.includes(agent.id)}
                      key={agent.name}
                      onClick={() =>
                        setSelectedAgents((previous) =>
                          previous.includes(agent.id)
                            ? previous.filter((id) => id !== agent.id)
                            : [...previous, agent.id],
                        )
                      }
                    >
                      <AgentAvatar name={agent.name} agents={agents} small />
                      {agent.name}
                      {selectedAgents.includes(agent.id) && (
                        <Check size={13} />
                      )}
                    </Button>
                  ))}
                </div>
                <p className="form-note">
                  Rooms and messages are saved to your organisation.
                </p>
                <Button type="submit" className="form-submit">
                  <Plus size={15} /> {creatingRoom ? 'Creating…' : 'Create room'}
                </Button>
                </fieldset>
              </form>
            )}
            {modal === "invite" && <InviteMembers />}
            {modal === "help" && (
              <div className="getting-started">
                {[
                  {
                    icon: MessageSquare,
                    title: "Start with a room",
                    text: "Give a project a home, a clear goal, and shared context.",
                  },
                  {
                    icon: Bot,
                    title: "Bring in the right agents",
                    text: "Choose specialists to work alongside your team.",
                  },
                  {
                    icon: Users,
                    title: "Move forward together",
                    text: "Follow room conversations and workspace activity in one place.",
                  },
                ].map(({ icon: Icon, title, text }) => (
                  <div key={title}>
                    <Icon size={20} />
                    <span>
                      <strong>{title}</strong>
                      <p>{text}</p>
                    </span>
                  </div>
                ))}
                <p className="form-note">
                  Rooms, agents, and messages are saved to your organisation.
                  Documents use your configured S3 storage.
                </p>
              </div>
            )}
            {modal === "notifications" && (
              <ActivityFeed
                events={events.slice(0, 3)}
                onOpen={(name) => {
                  const room = rooms.find((item) => item.name === name);
                  if (room) {
                    setModal(null);
                    openRoom(room);
                  }
                }}
              />
            )}
            {notice && (
              <p className="form-note" role="status">
                {notice}
              </p>
            )}
          </DialogContent>
        </Dialog>
        {modal === "agent" && (
          <CreateAgentDialog
            onClose={() => { setModal(null); setNotice(""); }}
            onCreate={createAgent}
          />
        )}
        {editingAgent && (
          <AgentProfileDialog
            key={editingAgent.id}
            agent={editingAgent}
            onClose={() => setEditingAgentId(null)}
            onSave={(profile) => saveAgent(editingAgent.id, editingAgent.name, profile)}
          />
        )}
        {notice && modal === null && (
          <div className="toast" role="status">
            <Check size={16} />
            {notice}
            <Button variant="ghost" size="sm"
              aria-label="Dismiss notification"
              onClick={() => setNotice("")}
            >
              <X size={15} />
            </Button>
          </div>
        )}
      </SidebarProvider>
    </TooltipProvider>
  );
}

function ActivityFeed({
  events,
  onOpen,
}: {
  events: Event[];
  onOpen: (name: string) => void;
}) {
  return (
    <div className="activity-feed">
      {events.map((event, index) => (
        <div
          className="activity-item"
          key={`${event.agent}-${event.target}-${index}`}
        >
          <span className={`activity-icon ${event.icon}`}>
            {event.icon === "check" ? (
              <Check size={15} />
            ) : event.icon === "message" ? (
              <FileText size={15} />
            ) : (
              <ArrowDownLeft size={15} />
            )}
          </span>
          <div>
            <p>
              <strong>{event.agent}</strong> {event.action}
            </p>
            <Button variant="ghost" size="sm" onClick={() => onOpen(event.target)}>{event.target}</Button>
          </div>
          <time>{event.time}</time>
        </div>
      ))}
    </div>
  );
}
