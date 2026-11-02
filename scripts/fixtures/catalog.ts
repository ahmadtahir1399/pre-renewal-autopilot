// Invented names and policy wording for the synthetic brokerage.
// Every name is made up. All email addresses use the reserved example.com domain.
// ASCII only: the PDF standard fonts and the S08 bitmap font cover nothing else.

import type { Broker, Client, ExclusionKey, Insurer, PolicyType } from '../../src/domain/types.js';

export const CLIENTS: Client[] = [
  { id: 'cli-01', name: 'Ironbark Joinery Ltd', contactName: 'Hana Whitcombe', contactEmail: 'hana.whitcombe@example.com' },
  { id: 'cli-02', name: 'Saltwind Cafe Group Ltd', contactName: 'Tomas Ferreira', contactEmail: 'tomas.ferreira@example.com' },
  { id: 'cli-03', name: 'Bluegum Freight Services Ltd', contactName: 'Priya Ranganathan', contactEmail: 'priya.ranganathan@example.com' },
  { id: 'cli-04', name: 'Fernvale Veterinary Clinic Ltd', contactName: 'Callum McAlister', contactEmail: 'callum.mcalister@example.com' },
  { id: 'cli-05', name: 'Quarry Lane Print Works Ltd', contactName: 'Mereana Doyle', contactEmail: 'mereana.doyle@example.com' },
];

/** Situation addresses printed on schedules (invented streets in an invented town). */
export const CLIENT_ADDRESSES: Record<string, string> = {
  'cli-01': '14 Totara Mill Road, Kestrel Bay',
  'cli-02': '3 Harbourview Lane, Kestrel Bay',
  'cli-03': '220 Depot Street, Kestrel Bay',
  'cli-04': '58 Paddock Crescent, Kestrel Bay',
  'cli-05': '9 Quarry Lane, Kestrel Bay',
};

export const BROKERS: Broker[] = [
  { id: 'brk-01', name: 'Alex Morrow', email: 'alex.morrow@example.com', telegramChatId: '000000001' },
  { id: 'brk-02', name: 'Sam Takerei', email: 'sam.takerei@example.com', telegramChatId: '000000002' },
];

export const BROKERAGE_NAME = 'Kestrel Bay Brokers (synthetic)';

/** Four invented insurers. Names only, no logos. */
export const INSURERS: Array<Insurer & { code: string }> = [
  { id: 'ins-01', name: 'Bellbird Mutual Assurance Ltd', code: 'BMA' },
  { id: 'ins-02', name: 'Copperleaf General Insurance Ltd', code: 'CGI' },
  { id: 'ins-03', name: 'Tarn and Fell Underwriting Ltd', code: 'TFU' },
  { id: 'ins-04', name: 'Larchmont Harbour Insurance Ltd', code: 'LHI' },
];

export const POLICY_TYPE_LABELS: Record<PolicyType, string> = {
  commercial_property: 'Commercial Property',
  public_liability: 'Public Liability',
  business_interruption: 'Business Interruption',
};

export const POLICY_TYPE_CODES: Record<PolicyType, string> = {
  commercial_property: 'CP',
  public_liability: 'PL',
  business_interruption: 'BI',
};

export const COVER_LIMIT_LABELS: Record<PolicyType, { label: string; suffix: string }> = {
  commercial_property: { label: 'Sum insured', suffix: '' },
  public_liability: { label: 'Limit of indemnity', suffix: ' any one occurrence' },
  business_interruption: { label: 'Sum insured (gross profit)', suffix: '' },
};

export interface ExclusionWording {
  title: string;
  text: string;
}

export interface ExclusionCatalogEntry {
  /** Canonical one-sentence meaning, used as the answer-key summary. */
  summary: string;
  /** Different wordings of the same meaning. Documents pick one with the seeded RNG. */
  wordings: ExclusionWording[];
}

export const EXCLUSION_CATALOG: Record<ExclusionKey, ExclusionCatalogEntry> = {
  flood: {
    summary: 'Loss or damage caused by flood or rising water is not covered.',
    wordings: [
      {
        title: 'Flood',
        text: 'We will not pay for loss or damage caused by flood, meaning water that escapes from or overflows the normal confines of any natural watercourse, lake, reservoir or the sea.',
      },
      {
        title: 'Flood and rising water',
        text: 'This policy does not cover damage resulting from rising water, including the overflow of rivers, streams, lakes or the sea onto normally dry land.',
      },
      {
        title: 'Inundation',
        text: 'Loss arising from the inundation of the insured premises by water from any natural body of water, or by storm surge, is excluded.',
      },
    ],
  },
  earthquake: {
    summary: 'Loss or damage caused by earthquake or volcanic activity is not covered.',
    wordings: [
      {
        title: 'Earthquake',
        text: 'We will not pay for loss or damage caused by earthquake, volcanic eruption or tsunami, except where the schedule states that natural hazard cover applies.',
      },
      {
        title: 'Seismic events',
        text: 'Damage arising directly or indirectly from earthquake shock, ground shaking or any resulting tsunami is not insured under this policy.',
      },
      {
        title: 'Earthquake and volcanic activity',
        text: 'This policy excludes loss caused by earthquake or volcanic activity, including fire that follows such an event.',
      },
    ],
  },
  wear_and_tear: {
    summary: 'Wear and tear from ordinary use is not covered.',
    wordings: [
      {
        title: 'Wear and tear',
        text: 'We will not pay for wear and tear resulting from the ordinary use of the property, including scuffing, fading and the mechanical wear of moving parts.',
      },
      {
        title: 'Normal wear',
        text: 'Costs caused by the normal wear of buildings, fittings or machinery through everyday use are not covered.',
      },
      {
        title: 'Wear, tear and depreciation',
        text: 'This policy excludes wear and tear, and the depreciation in value of any insured item through use.',
      },
    ],
  },
  gradual_deterioration: {
    summary: 'Damage that develops gradually (rust, corrosion, rot, mould) is not covered.',
    wordings: [
      {
        title: 'Gradual deterioration',
        text: 'We will not pay for loss or damage caused by gradual deterioration, including rust, corrosion, rot, mould or decay that develops slowly over time.',
      },
      {
        title: 'Slow-developing damage',
        text: 'Damage that happens progressively over a period of time, such as rusting, rotting, mildew or the slow breakdown of materials, is excluded.',
      },
      {
        title: 'Progressive decay',
        text: 'This policy does not respond to the steady decline in condition of any property through corrosion, decay, damp or mould.',
      },
    ],
  },
  theft_unattended_premises: {
    summary: 'Theft while the premises are unattended is not covered unless there was forced entry.',
    wordings: [
      {
        title: 'Theft from unattended premises',
        text: 'We will not pay for theft from the premises while they are left unattended, unless there is visible evidence of forcible and violent entry.',
      },
      {
        title: 'Unattended premises',
        text: 'Theft occurring while no authorised person is present at the premises is not covered, except where entry was gained by force that leaves visible damage.',
      },
      {
        title: 'Theft without forced entry',
        text: 'Loss by theft when the premises are unattended and there is no sign of forced entry is excluded.',
      },
    ],
  },
  vacant_or_unoccupied_building: {
    summary: 'Loss to a building left vacant or unoccupied for more than 60 days is not covered.',
    wordings: [
      {
        title: 'Vacant or unoccupied buildings',
        text: 'We will not pay for loss or damage to any building that has been vacant or unoccupied for more than 60 consecutive days.',
      },
      {
        title: 'Unoccupancy',
        text: 'Cover for a building ceases once it has been left empty or not in use for a continuous period of more than 60 days, unless we have agreed otherwise in writing.',
      },
      {
        title: 'Empty buildings',
        text: 'This policy excludes damage to buildings that have stood empty for longer than 60 days in a row.',
      },
    ],
  },
  cyber_event: {
    summary: 'Loss caused by a cyber event or damage to electronic data is not covered.',
    wordings: [
      {
        title: 'Cyber events',
        text: 'We will not pay for loss caused by a cyber event, including hacking, malicious software, denial of service or the corruption of electronic data.',
      },
      {
        title: 'Computer virus and hacking',
        text: 'Any loss arising from unauthorised access to computer systems, computer viruses, or the loss or distortion of digital data is excluded.',
      },
      {
        title: 'Electronic data and cyber attack',
        text: 'This policy does not cover losses that result from a cyber attack or from damage to electronic data or software.',
      },
    ],
  },
  terrorism: {
    summary: 'Loss caused by an act of terrorism is not covered.',
    wordings: [
      {
        title: 'Terrorism',
        text: 'We will not pay for loss, damage, cost or liability caused by or resulting from any act of terrorism.',
      },
      {
        title: 'Acts of terrorism',
        text: 'This policy excludes any loss directly or indirectly caused by an act of terrorism, or by any action taken to control or prevent such an act.',
      },
      {
        title: 'Terrorist acts',
        text: 'Loss arising from a terrorist act, whatever the cause of that act, is not insured.',
      },
    ],
  },
  pollution: {
    summary: 'Liability for pollution or contamination is not covered unless it is sudden and accidental.',
    wordings: [
      {
        title: 'Pollution',
        text: 'We will not pay for liability arising from the discharge, dispersal, release or escape of any pollutant or contaminant, unless it is sudden, identifiable and accidental.',
      },
      {
        title: 'Contamination',
        text: 'Liability for pollution or contamination of land, air or water is excluded, except where it results from a sudden and unexpected event.',
      },
      {
        title: 'Pollutants',
        text: 'This policy does not cover any claim caused by the release or seepage of pollutants, other than a sudden and accidental release.',
      },
    ],
  },
  asbestos: {
    summary: 'Loss or liability arising from asbestos is not covered.',
    wordings: [
      {
        title: 'Asbestos',
        text: 'We will not pay for any loss or liability arising from asbestos or any material containing asbestos.',
      },
      {
        title: 'Asbestos materials',
        text: 'Claims connected with the presence, removal or inhalation of asbestos fibres or asbestos products are excluded.',
      },
      {
        title: 'Asbestos-related claims',
        text: 'This policy does not respond to injury, damage or cost that arises in any way from asbestos.',
      },
    ],
  },
  subsidence_landslip: {
    summary: 'Damage caused by subsidence, landslip or ground movement is not covered.',
    wordings: [
      {
        title: 'Subsidence and landslip',
        text: 'We will not pay for loss or damage caused by subsidence, settlement, landslip or the movement of the ground beneath the premises.',
      },
      {
        title: 'Ground movement',
        text: 'Damage caused by the sinking, shrinking or sliding of land, including landslides and the settlement of foundations, is excluded.',
      },
      {
        title: 'Landslip',
        text: 'This policy excludes loss arising from landslip, subsidence or erosion of the site.',
      },
    ],
  },
  contractual_liability: {
    summary: 'Liability accepted under a contract, beyond legal liability, is not covered.',
    wordings: [
      {
        title: 'Contractual liability',
        text: 'We will not pay for liability that you have accepted under a contract or agreement, unless you would have been liable without that contract.',
      },
      {
        title: 'Liability assumed by agreement',
        text: 'Any liability that the insured has taken on by contract, which would not otherwise attach by law, is excluded.',
      },
      {
        title: 'Contract terms',
        text: 'This policy does not cover obligations you agree to under any contract, warranty or indemnity beyond your legal liability.',
      },
    ],
  },
  professional_advice: {
    summary: 'Liability arising from professional advice or design is not covered.',
    wordings: [
      {
        title: 'Professional advice',
        text: 'We will not pay for liability arising from any professional advice, design, specification or consultancy provided for a fee.',
      },
      {
        title: 'Professional services',
        text: 'Claims arising out of advice, designs or professional services given by the insured, or on its behalf, are excluded.',
      },
      {
        title: 'Advice and design',
        text: 'This policy does not cover loss caused by negligent advice, design or professional opinion.',
      },
    ],
  },
  other: {
    summary: 'No cover where providing it would breach trade or economic sanctions.',
    wordings: [
      {
        title: 'Sanctions',
        text: 'We will not provide cover or pay any claim where doing so would expose us to any sanction, prohibition or restriction under trade or economic sanctions laws.',
      },
      {
        title: 'Sanctions limitation',
        text: 'No cover is provided to the extent that it would breach any applicable trade or economic sanction.',
      },
      {
        title: 'Sanctions restriction',
        text: 'This policy does not apply where providing cover would breach sanctions or embargo laws.',
      },
    ],
  },
};

/** Page 2: what is covered. Each entry is [heading, wording A, wording B]. */
export const COVER_SECTIONS: Record<PolicyType, Array<[string, string, string]>> = {
  commercial_property: [
    [
      'Material damage',
      'We will cover sudden and accidental physical loss of, or damage to, the insured property at the situation shown in the schedule, up to the sum insured.',
      'You are insured for unforeseen physical loss or damage to the property described in the schedule while it is at the insured situation, up to the sum insured.',
    ],
    [
      'Additional benefits',
      'Within the sum insured we will also pay reasonable costs for the removal of debris, up to NZD 50,000, and for glass breakage, up to NZD 10,000.',
      'The following are included within the sum insured: debris removal costs up to NZD 50,000 and accidental glass breakage up to NZD 10,000.',
    ],
    [
      'Basis of settlement',
      'Buildings are settled on a replacement basis. Contents are settled on an indemnity basis unless the schedule says otherwise.',
      'We will reinstate buildings to a condition equal to, but not better than, when new. Contents are paid at their indemnity value.',
    ],
  ],
  public_liability: [
    [
      'Legal liability',
      'We will cover your legal liability to pay compensation for accidental personal injury, or accidental damage to property, that happens during the period of insurance in connection with your business.',
      'You are insured for compensation you become legally liable to pay because of accidental injury to people, or accidental loss of or damage to property, arising from your business during the period of insurance.',
    ],
    [
      'Defence costs',
      'We will also pay the reasonable legal costs of defending a claim we have agreed to cover, up to NZD 250,000 in addition to the limit of indemnity.',
      'Reasonable costs incurred with our consent to defend a covered claim are paid in addition to the limit of indemnity, up to NZD 250,000.',
    ],
    [
      'Territorial limits',
      'Cover applies to occurrences within New Zealand.',
      'This section responds only to events that happen in New Zealand.',
    ],
  ],
  business_interruption: [
    [
      'Loss of gross profit',
      'We will cover the loss of gross profit you suffer because your business is interrupted by insured damage at the premises, during the indemnity period.',
      'If insured damage at the premises interrupts your business, we will pay the resulting reduction in gross profit during the indemnity period.',
    ],
    [
      'Indemnity period',
      'The indemnity period is the 12 months that start on the date of the damage.',
      'Cover for lost gross profit lasts for up to 12 months after the damage occurs.',
    ],
    [
      'Increased cost of working',
      'Reasonable extra costs you incur to keep the business running after insured damage are covered up to NZD 100,000.',
      'We will pay additional expenses reasonably incurred to minimise the interruption, up to NZD 100,000.',
    ],
  ],
};

/** Page 3: general conditions. Each entry is [heading, wording A, wording B]. */
export const CONDITIONS: Array<[string, string, string]> = [
  [
    'Claims',
    'You must tell us as soon as reasonably possible about any event that may lead to a claim, and you must not admit liability without our written consent.',
    'Notify us promptly of any incident that could give rise to a claim. Do not admit fault or agree to any settlement without our written agreement.',
  ],
  [
    'Reasonable precautions',
    'You must take all reasonable steps to prevent loss, damage or liability, and keep the insured property in good condition.',
    'You must act reasonably to avoid loss and must maintain the insured property in a sound state of repair.',
  ],
  [
    'Disclosure',
    'You must tell us about any change in your business, or in the insured property, that could affect this insurance.',
    'Tell us straight away about any change to your business activities or premises that might affect the risk we have agreed to cover.',
  ],
  [
    'Cancellation',
    'You may cancel this policy at any time. We may cancel it by giving you 30 days notice in writing.',
    'Either party may cancel this policy. If we cancel, we will give you at least 30 days written notice.',
  ],
  [
    'Currency and GST',
    'All amounts in this document are in New Zealand dollars and exclude GST unless stated otherwise.',
    'Amounts are shown in New Zealand dollars, excluding GST, unless the document says otherwise.',
  ],
];

export const SYNTHETIC_NOTICE = 'SYNTHETIC TEST DOCUMENT - fictional insurer and insured - not a real policy';
