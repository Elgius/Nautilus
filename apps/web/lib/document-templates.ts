export type DocumentCategory =
  | "Notes"
  | "Plans"
  | "Reports"
  | "Briefs"
  | "Research"
  | "Guides"
  | "Knowledge"
  | "Client documents"
  | "Finance"
  | "Presentations";

export type DocumentTemplate = {
  id: string;
  title: string;
  category: DocumentCategory;
  description: string;
  sections: string[];
};

export const documentTemplates: DocumentTemplate[] = [
  {
    id: "meeting-notes",
    title: "Meeting notes",
    category: "Notes",
    description: "Capture the discussion, decisions, and who does what next.",
    sections: [
      "Date and attendees",
      "Meeting objective",
      "Discussion notes",
      "Decisions",
      "Action items · owner · due date",
    ],
  },
  {
    id: "meeting-agenda",
    title: "Meeting agenda",
    category: "Notes",
    description: "Give every meeting a purpose and a clear plan.",
    sections: [
      "Meeting objective",
      "Attendees",
      "Topics and time allocations",
      "Pre-reading",
      "Desired outcomes",
    ],
  },
  {
    id: "daily-notes",
    title: "Daily notes",
    category: "Notes",
    description: "A place for daily priorities, ideas, and follow-ups.",
    sections: [
      "Date",
      "Today’s priorities",
      "Notes and ideas",
      "Follow-ups",
      "End-of-day reflection",
    ],
  },
  {
    id: "project-brief",
    title: "Project brief",
    category: "Briefs",
    description:
      "Align everyone on the problem, audience, and intended outcome.",
    sections: [
      "Background",
      "Problem and opportunity",
      "Target audience",
      "Goals and success measures",
      "Scope",
      "Stakeholders",
      "Open questions",
    ],
  },
  {
    id: "project-plan",
    title: "Project plan",
    category: "Plans",
    description: "Turn a shared goal into milestones and responsibilities.",
    sections: [
      "Project objective",
      "Deliverables",
      "Milestones and timeline",
      "Owners and responsibilities",
      "Dependencies",
      "Risks",
      "Next steps",
    ],
  },
  {
    id: "weekly-priorities",
    title: "Weekly priorities",
    category: "Plans",
    description: "Keep the team focused on what matters this week.",
    sections: [
      "Week of",
      "Top priorities",
      "Tasks · owner · due date",
      "Dependencies and blockers",
      "Upcoming deadlines",
      "Weekly review",
    ],
  },
  {
    id: "report",
    title: "Report",
    category: "Reports",
    description: "Share progress, results, and recommendations clearly.",
    sections: [
      "Reporting period",
      "Executive summary",
      "Progress and achievements",
      "Key metrics",
      "Risks and blockers",
      "Recommendations",
      "Next steps",
    ],
  },
  {
    id: "research",
    title: "Research",
    category: "Research",
    description: "Organize questions, evidence, and useful findings.",
    sections: [
      "Research question",
      "Background",
      "Methodology",
      "Sources and evidence",
      "Findings",
      "Limitations",
      "Recommendations",
    ],
  },
  {
    id: "business-proposal",
    title: "Business proposal",
    category: "Briefs",
    description: "Present an opportunity and a concrete way forward.",
    sections: [
      "Executive summary",
      "The opportunity",
      "Proposed solution",
      "Scope and deliverables",
      "Timeline",
      "Estimated investment",
      "Success measures",
      "Next steps",
    ],
  },
  {
    id: "sop",
    title: "SOP",
    category: "Guides",
    description: "Document a repeatable process, step by step.",
    sections: [
      "Process name and owner",
      "Purpose",
      "Scope",
      "Prerequisites",
      "Step-by-step procedure",
      "Quality checklist",
      "Exceptions and escalation",
      "Review date",
    ],
  },
  {
    id: "onboarding-guide",
    title: "Onboarding guide",
    category: "Guides",
    description: "Help new teammates get started with confidence.",
    sections: [
      "Welcome",
      "Before your first day",
      "People to meet",
      "Tools and access",
      "First-week checklist",
      "First-month goals",
      "Helpful resources",
    ],
  },
  {
    id: "decision-log",
    title: "Decision log",
    category: "Knowledge",
    description: "Keep a record of decisions and the reasoning behind them.",
    sections: [
      "Decision and date",
      "Context",
      "Options considered",
      "Decision owner",
      "Reasoning",
      "Impact and follow-up",
      "Review date",
    ],
  },
  {
    id: "team-policy",
    title: "Team policy",
    category: "Knowledge",
    description:
      "Make expectations, responsibilities, and processes easy to find.",
    sections: [
      "Policy name and owner",
      "Purpose",
      "Who this applies to",
      "Guidelines",
      "Responsibilities",
      "Exceptions",
      "Effective date and review schedule",
    ],
  },
  {
    id: "client-requirements",
    title: "Client requirements",
    category: "Client documents",
    description:
      "Capture the client’s needs, constraints, and acceptance criteria.",
    sections: [
      "Client and project",
      "Business objectives",
      "Requirements",
      "Constraints",
      "Out of scope",
      "Acceptance criteria",
      "Open questions",
      "Approvals",
    ],
  },
  {
    id: "quotation",
    title: "Quotation",
    category: "Client documents",
    description: "Outline services, quantities, and estimated pricing.",
    sections: [
      "Quote number and date",
      "Prepared for",
      "Prepared by",
      "Items · quantity · unit price · total",
      "Taxes and total",
      "Validity period",
      "Notes",
    ],
  },
  {
    id: "statement-of-work",
    title: "Statement of work",
    category: "Client documents",
    description:
      "Structure the deliverables, milestones, and project responsibilities.",
    sections: [
      "Project overview",
      "Scope",
      "Deliverables",
      "Timeline and milestones",
      "Responsibilities",
      "Acceptance criteria",
      "Commercial terms to confirm",
      "Review and approval",
    ],
  },
  {
    id: "budget",
    title: "Budget",
    category: "Finance",
    description: "Plan spending and compare estimates with actual costs.",
    sections: [
      "Budget period and owner",
      "Assumptions",
      "Cost categories · planned · actual · variance",
      "Total budget",
      "Contingency",
      "Notes and approvals",
    ],
  },
  {
    id: "invoice",
    title: "Invoice",
    category: "Finance",
    description: "A starting outline for billing a client.",
    sections: [
      "Invoice number and date",
      "From",
      "Bill to",
      "Items · quantity · rate · amount",
      "Subtotal",
      "Taxes and total due",
      "Payment due date",
      "Payment details",
    ],
  },
  {
    id: "expense-report",
    title: "Expense report",
    category: "Finance",
    description: "Organize expenses and supporting receipts for review.",
    sections: [
      "Employee and reporting period",
      "Business purpose",
      "Date · category · description · amount",
      "Receipts",
      "Total",
      "Submitted to",
      "Approval status",
    ],
  },
  {
    id: "presentation",
    title: "Presentation outline",
    category: "Presentations",
    description: "Build a clear narrative before creating your slides.",
    sections: [
      "Audience and objective",
      "Key message",
      "Opening",
      "Slide-by-slide outline",
      "Supporting evidence",
      "Recommendations",
      "Call to action",
      "Q&A notes",
    ],
  },
  {
    id: "blank",
    title: "Blank document",
    category: "Briefs",
    description: "Start fresh and make space for your own ideas.",
    sections: [],
  },
];
