/**
 * Hardening helpers for tool inputs.
 *
 * Defense in depth: not a complete content-safety solution, but a cheap first
 * gate that blocks the obvious abuse vectors before they hit upstream APIs
 * (which then either bill us or produce reportable output).
 */

export const MAX_PROMPT_LENGTH = 1024;
export const MAX_URL_LENGTH = 2048;

export function clampText(input: string, maxLen = MAX_PROMPT_LENGTH): string {
  return input.trim().slice(0, maxLen);
}

/**
 * Append to system prompts. Keeps the model's voice but installs a refusal
 * floor for the categories most likely to generate moderation problems on
 * a Farcaster surface.
 */
export const SAFETY_SUFFIX = `

Refuse politely (one short sentence, no lecture) if the user is asking for: hate speech or slurs against people or groups; doxxing or other privacy violations; instructions to physically harm a person; child sexual abuse material; instructions to make weapons or drugs; or content depicting real public figures in compromising scenarios.`;

/**
 * Block the most obvious image-prompt abuse before sending to a model. We
 * still rely on the model's own safety_checker for the long tail — pick a
 * model that has one (Stable Diffusion family does by default).
 */
const IMAGE_DENY_PATTERNS: RegExp[] = [
  /\bcsam\b/i,
  /\bchild\b.*\b(porn|nude|sexual)\b/i,
  /\bnude\b.*\bchild\b/i,
  /\bunderage\b/i,
  /\bloli(ta)?\b/i,
];

export function isImagePromptBlocked(prompt: string): boolean {
  return IMAGE_DENY_PATTERNS.some((re) => re.test(prompt));
}
