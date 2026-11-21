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
