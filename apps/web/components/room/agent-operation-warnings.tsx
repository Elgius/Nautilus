import { agentErrorMessages, reviewReasonMessages, type AgentOperationIssue } from '../../../../shared/agent-errors';

export function AgentOperationWarnings({ issues }: { issues?: AgentOperationIssue[] }) {
  if (!issues?.length) return null;
  const unique = new Map(issues.map((issue) => [`${issue.code}:${issue.reason ?? ''}`, issue]));
  return <details className="room-private-status">
    <summary>Some operations failed. Review the response and saved changes.</summary>
    <ul>{[...unique.entries()].map(([key, issue]) => <li key={key}>
      {agentErrorMessages[issue.code]}{issue.reason ? ` ${reviewReasonMessages[issue.reason]}` : ''}
    </li>)}</ul>
  </details>;
}
