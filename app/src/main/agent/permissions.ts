/**
 * OWNER: C. Role-based rights for Tap's agents (Nexthink): Tap never has more authority than the person it works for.
 * Two scales grow with rank: what the agent may do towards OTHER people (more), and how confidential the user's
 * meetings are (stricter). The policy is data in one place; every cell has a test. Never decided by an LLM.
 * The role comes from config (company SSO in real life), never from speech, AI output or a production UI.
 */
import { USER_ROLES, type UserRole } from '../../shared/events.ts'
import type { ActionRequest } from './schemas.ts'

export const ROLES = USER_ROLES
export type { UserRole }

/**
 * T0 notify the user · T1 the user's own device or data · T2 speak for the user · T3 affect others.
 * No action is T2 or T3 today (Tap runs on top of Teams/Meet and cannot reach documents or attendees);
 * the rows stay so a future action gets its role check by adding one line to ACTION_TIER.
 */
export type Tier = 0 | 1 | 2 | 3
/** auto = the agent may do it itself · click = only the user's own click on Tap's button · deny = never for this role */
export type Permission = 'auto' | 'click' | 'deny'

/** Every action the executor knows, with its tier. A new action does not compile until it gets a tier here. */
export const ACTION_TIER: Record<ActionRequest['action'], Tier> = {
  show_away_summary: 0,
  show_recap: 0,
  show_nudge: 0,
  show_fix: 0,
  send_haptic: 0,
  dismiss_card: 0,
  switch_input_device: 1, // your own mic
  fix_mic: 1, // your own mic, at the Windows level
  open_it_ticket: 1 // your own device facts, to your own IT
}

export const MATRIX: Record<Tier, Record<UserRole, Permission>> = {
  0: { intern: 'auto', senior: 'auto', executive: 'auto', ceo: 'auto' },
  1: { intern: 'click', senior: 'click', executive: 'click', ceo: 'click' },
  2: { intern: 'deny', senior: 'click', executive: 'click', ceo: 'click' }, // never automatic, for anyone
  3: { intern: 'deny', senior: 'deny', executive: 'click', ceo: 'click' }
}

export interface RoleFlags {
  label: string
  /** Meetings are confidential: no cloud AI (summaries made on the laptop), no event recording. */
  confidential: boolean
  /** The IT view (team metrics) is shown. */
  seesItView: boolean
  /** IT tickets from this person get priority (executive support). */
  ticketPriority: 'normal' | 'priority'
}

export const ROLE_FLAGS: Record<UserRole, RoleFlags> = {
  intern: { label: 'intern', confidential: false, seesItView: false, ticketPriority: 'normal' },
  senior: { label: 'senior / tech lead', confidential: false, seesItView: true, ticketPriority: 'normal' },
  executive: { label: 'executive', confidential: true, seesItView: true, ticketPriority: 'priority' },
  ceo: { label: 'CEO', confidential: true, seesItView: true, ticketPriority: 'priority' }
}

export function permission(role: UserRole, action: ActionRequest['action']): Permission {
  return MATRIX[ACTION_TIER[action]][role]
}

/** Missing or unknown role → intern (least privilege). */
export function roleFromConfig(value: unknown): UserRole {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return (ROLES as readonly string[]).includes(v) ? (v as UserRole) : 'intern'
}

/** Plain-words reason for a denial, for the judges' log. */
export function denyReason(role: UserRole, action: ActionRequest['action']): string {
  const tier = ACTION_TIER[action]
  const who = ROLE_FLAGS[role].label
  if (tier === 3) return `acting towards other people is for executives and the CEO (you: ${who}, T3)`
  if (tier === 2) return `speaking in your name is not allowed for your role (you: ${who}, T2)`
  return `not allowed for your role (you: ${who}, T${tier})`
}

/**
 * The current role, shared by the agents (config, not a message). Only index.ts sets it: from config at start,
 * and from the dev-only switch when the app is not packaged.
 */
export class RoleState {
  private current: UserRole
  private listeners: ((role: UserRole) => void)[] = []

  constructor(role: UserRole = 'intern') {
    this.current = role
  }

  get role(): UserRole {
    return this.current
  }

  get flags(): RoleFlags {
    return ROLE_FLAGS[this.current]
  }

  set(role: UserRole): void {
    if (role === this.current) return
    this.current = role
    for (const l of this.listeners) l(role)
  }

  onChange(l: (role: UserRole) => void): void {
    this.listeners.push(l)
  }
}
