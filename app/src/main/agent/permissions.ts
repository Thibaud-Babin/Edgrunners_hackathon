/**
 * OWNER: C. Risk tiers for every allowlisted action (doc §3). Data in one place.
 *   T0 notify: shows or buzzes, only to the user.   T1 own device: changes the user's own setup.
 *   T2 speak for you: others see it, in the user's name.   T3 affect others: none yet.
 */
import type { AllowedAction } from '../../shared/events.ts'

export type Tier = 0 | 1 | 2 | 3

export const ACTION_TIER: Record<AllowedAction, Tier> = {
  show_recap: 0,
  show_away_summary: 0,
  show_fix: 0,
  send_haptic: 0,
  dismiss_card: 0,
  switch_input_device: 1,
  post_chat_reply: 2,
  speak_reply: 2,
  raise_hand_overlay: 2
}

// ---------- roles (doc §3) ----------
// Tap never gets more authority than the person it works for.
// The role comes from config only (TAP_USER_ROLE), never from speech, LLM output or production UI.

export const ROLES = ['intern', 'senior', 'executive', 'ceo'] as const
export type Role = (typeof ROLES)[number]
/** auto = Tap does it · confirm = Tap asks first · deny = Tap only suggests and logs why. */
export type Permission = 'auto' | 'confirm' | 'deny'

export const MATRIX: Record<Tier, Record<Role, Permission>> = {
  0: { intern: 'auto', senior: 'auto', executive: 'auto', ceo: 'auto' }, // notify
  1: { intern: 'confirm', senior: 'auto', executive: 'auto', ceo: 'auto' }, // own device
  2: { intern: 'deny', senior: 'confirm', executive: 'confirm', ceo: 'confirm' }, // speak for you: never auto
  3: { intern: 'deny', senior: 'deny', executive: 'confirm', ceo: 'confirm' } // affect others
}

export function permission(role: Role, tier: Tier): Permission {
  return MATRIX[tier][role]
}

/** Missing or unknown role → intern (least privilege). */
export function roleFromConfig(value: unknown): Role {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return (ROLES as readonly string[]).includes(v) ? (v as Role) : 'intern'
}

/** For log lines: what each tier lets Tap do. */
export const TIER_VERB: Record<Tier, string> = {
  0: 'notify you',
  1: 'change your own devices',
  2: 'speak for you',
  3: 'act on other people'
}
