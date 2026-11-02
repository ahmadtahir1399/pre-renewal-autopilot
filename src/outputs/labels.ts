// Broker-facing labels used in the spreadsheet and the draft emails.

import type { PolicyType } from '../domain/types.js';

export const POLICY_TYPE_LABELS: Record<PolicyType, string> = {
  commercial_property: 'Commercial Property',
  public_liability: 'Public Liability',
  business_interruption: 'Business Interruption',
};

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** Month names for reading long dates back ("17 January 2027"); writing uses formatLongDate from domain/dates. */
export { MONTH_NAMES };
