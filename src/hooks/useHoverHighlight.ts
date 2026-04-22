import { useState, useCallback, useMemo } from "react";
import type { AgentQueueMap } from "./useAgentQueueMap";

/**
 * Drives the "Option A" cross-highlight:
 *
 *  - Hover an agent → related contact bubbles glow, others dim
 *  - Hover a bubble → related agents glow, others dim
 */
export interface HoverHighlight {
  hoveredAgentId: string | null;
  hoveredContactId: string | null;
  setHoveredAgent: (id: string | null) => void;
  setHoveredContact: (id: string | null) => void;
  /** Whether a given contact should appear "glowing" right now. */
  contactIsHighlighted: (contactId: string) => boolean;
  /** Whether a given contact should appear "dimmed" right now. */
  contactIsDimmed: (contactId: string) => boolean;
  /** Whether a given agent should appear "glowing" right now. */
  agentIsHighlighted: (userId: string) => boolean;
  /** Whether a given agent should appear "dimmed" right now. */
  agentIsDimmed: (userId: string) => boolean;
  /** Whether any highlight is currently active (for global dim layer). */
  isActive: boolean;
}

export function useHoverHighlight(map: AgentQueueMap): HoverHighlight {
  const [hoveredAgentId, setHoveredAgentId] = useState<string | null>(null);
  const [hoveredContactId, setHoveredContactId] = useState<string | null>(null);

  const {
    highlightedAgents,
    highlightedContacts,
  } = useMemo(() => {
    if (hoveredAgentId) {
      const contacts = new Set<string>();
      const list = map.inQueueByAgent.get(hoveredAgentId) || [];
      for (const c of list) contacts.add(c.contactId);
      return {
        highlightedAgents: new Set([hoveredAgentId]),
        highlightedContacts: contacts,
      };
    }
    if (hoveredContactId) {
      const agents = new Set<string>();
      for (const uid of map.eligibleAgentsByContact.get(hoveredContactId) || []) {
        agents.add(uid);
      }
      return {
        highlightedAgents: agents,
        highlightedContacts: new Set([hoveredContactId]),
      };
    }
    return {
      highlightedAgents: new Set<string>(),
      highlightedContacts: new Set<string>(),
    };
  }, [hoveredAgentId, hoveredContactId, map]);

  const isActive = !!(hoveredAgentId || hoveredContactId);

  return {
    hoveredAgentId,
    hoveredContactId,
    setHoveredAgent: useCallback((id: string | null) => {
      setHoveredAgentId(id);
      setHoveredContactId(null);
    }, []),
    setHoveredContact: useCallback((id: string | null) => {
      setHoveredContactId(id);
      setHoveredAgentId(null);
    }, []),
    contactIsHighlighted: (id) => highlightedContacts.has(id),
    contactIsDimmed: (id) => isActive && !highlightedContacts.has(id),
    agentIsHighlighted: (uid) => highlightedAgents.has(uid),
    agentIsDimmed: (uid) => isActive && !highlightedAgents.has(uid),
    isActive,
  };
}
