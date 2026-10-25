export type Room = {
  id: string;
  name: string;
  description: string;
  category: string;
  status: "Working" | "Ready" | "Needs review";
  agents: string[];
  agentIds: string[];
  members: string[];
  documentCount: number;
  documents: { id: string; title: string; kind: 'DOCUMENT' | 'SPREADSHEET'; status: string; updatedAt: string }[];
  updated: string;
  favorite: boolean;
  color: string;
  contentTypes?: ("document" | "spreadsheet")[];
};

