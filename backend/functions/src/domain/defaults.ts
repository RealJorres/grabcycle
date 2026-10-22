import type {
  AppConfig,
  DocumentPolicy,
  FareConfig,
  MatchingConfig,
  PaymentsConfig,
  PoliciesConfig,
  ServiceAreaConfig,
} from './config';

/**
 * DEVELOPMENT / SAMPLE CONFIGURATION.
 *
 * Operational defaults (matching, policies, payments, app) are safe engineering
 * starting points and are used as fallbacks when no Firestore document exists.
 *
 * SAMPLE_* values (service area, document policy, fares) are NOT official and
 * are NEVER used as a runtime fallback: they are only written by the seed
 * script for development. Production must configure them explicitly after
 * confirming requirements with the competent authorities.
 */

export const DEFAULT_MATCHING: MatchingConfig = {
  initialRadiusM: 2000,
  radiusStepM: 1000,
  maxRadiusM: 5000,
  locationFreshnessSec: 30,
  maxLocationAccuracyM: 100,
  locationUpdateIntervalSec: 5,
  offerTimeoutSec: 20,
  searchTimeoutSec: 180,
  maxCandidates: 10,
  maxDiscoveryResults: 20,
  arrivalMaxDistanceM: 500,
  staleDriverAutoOfflineMin: 10,
  missedOffersBeforeOffline: 3,
  quoteTtlSec: 600,
  rejectMockLocations: true,
};

export const DEFAULT_POLICIES: PoliciesConfig = {
  cancellation: {
    passengerFeeEnabled: false,
    passengerFee: 0,
    passengerFeeAfterAcceptMinutes: 3,
    driverNoShowWaitMinutes: 5,
  },
  ratings: { minRatingsToDisplay: 5, ratingWindowDays: 7 },
  retention: {
    rideRecordsDays: 1825,
    rejectedDocumentsDays: 90,
    stagingUploadsHours: 24,
    auditLogDays: 1825,
  },
  terms: { termsVersion: '2026-10', privacyNoticeVersion: '2026-10' },
};

export const DEFAULT_PAYMENTS: PaymentsConfig = {
  enabledMethods: ['CASH'],
  cashDiscrepancyTolerance: 0,
};

export const DEFAULT_APP: AppConfig = {
  announcements: [],
  supportPhone: '',
  supportEmail: '',
  emergencyHotline: '911',
  minAndroidVersionCode: 0,
  maintenanceMode: false,
};

/**
 * Approximate outline of Marinduque's main island for DEVELOPMENT ONLY.
 * Replace with an authoritative boundary (e.g. PSA/NAMRIA administrative
 * boundaries) and add polygons for any served smaller islands.
 */
export const SAMPLE_SERVICE_AREA: ServiceAreaConfig = {
  name: 'Marinduque (sample boundary)',
  polygons: [
    {
      name: 'Marinduque main island (approximate)',
      points: [
        { lat: 13.585, lng: 121.835 },
        { lat: 13.56, lng: 121.99 },
        { lat: 13.5, lng: 122.11 },
        { lat: 13.42, lng: 122.17 },
        { lat: 13.3, lng: 122.15 },
        { lat: 13.19, lng: 122.05 },
        { lat: 13.16, lng: 121.94 },
        { lat: 13.21, lng: 121.84 },
        { lat: 13.33, lng: 121.79 },
        { lat: 13.46, lng: 121.8 },
      ],
    },
  ],
  municipalities: ['Boac', 'Buenavista', 'Gasan', 'Mogpog', 'Santa Cruz', 'Torrijos'],
  boundsMarginDeg: 0.05,
  operatingHours: { enabled: false, startHour: 5, endHour: 22 },
  isSample: true,
};

export const SAMPLE_DOCUMENT_POLICY: DocumentPolicy = {
  isSample: true,
  passengerApprovalValidityDays: null,
  maxUploadBytes: 6 * 1024 * 1024,
  privacyNoticeVersion: '2026-10',
  passengerIdTypes: [
    { code: 'PHILSYS', label: 'PhilSys National ID / ePhilID', sides: ['FRONT', 'BACK'], hasExpiry: false, active: true },
    { code: 'DRIVERS_LICENSE', label: "Driver's License (LTO)", sides: ['FRONT', 'BACK'], hasExpiry: true, active: true },
    { code: 'PASSPORT', label: 'Philippine Passport', sides: ['FRONT'], hasExpiry: true, active: true },
    { code: 'UMID', label: 'UMID', sides: ['FRONT', 'BACK'], hasExpiry: false, active: true },
    { code: 'POSTAL_ID', label: 'Postal ID', sides: ['FRONT', 'BACK'], hasExpiry: true, active: true },
    { code: 'PRC_ID', label: 'PRC ID', sides: ['FRONT', 'BACK'], hasExpiry: true, active: true },
    { code: 'SENIOR_CITIZEN_ID', label: 'Senior Citizen ID', sides: ['FRONT', 'BACK'], hasExpiry: false, active: true },
    { code: 'PWD_ID', label: 'PWD ID', sides: ['FRONT', 'BACK'], hasExpiry: true, active: true },
  ],
  driverRequirements: [
    {
      code: 'PROFILE_PHOTO',
      label: 'Profile photo',
      description: 'A clear, recent photo of your face. Shown to passengers after approval so they can recognize you.',
      scope: 'DRIVER',
      mandatory: true,
      sides: ['PHOTO'],
      hasExpiry: false,
      numberField: null,
      publishAsProfilePhoto: true,
      expiryReminderDays: [],
      regulatoryNote: '',
      active: true,
    },
    {
      code: 'DRIVERS_LICENSE',
      label: "Driver's license",
      description: 'Front and back of your valid LTO driver’s license.',
      scope: 'DRIVER',
      mandatory: true,
      sides: ['FRONT', 'BACK'],
      hasExpiry: true,
      numberField: { label: 'License number', pattern: '^[A-Z0-9-]{6,20}$', required: true },
      publishAsProfilePhoto: false,
      expiryReminderDays: [30, 7, 1],
      regulatoryNote: 'Confirm with LTO the license type and restriction codes required to operate a tricycle.',
      active: true,
    },
    {
      code: 'VEHICLE_OR',
      label: 'Official Receipt (OR)',
      description: 'Current LTO Official Receipt of registration for the tricycle.',
      scope: 'VEHICLE',
      mandatory: true,
      sides: ['FRONT'],
      hasExpiry: true,
      numberField: null,
      publishAsProfilePhoto: false,
      expiryReminderDays: [30, 7, 1],
      regulatoryNote: 'Confirm registration validity rules with LTO.',
      active: true,
    },
    {
      code: 'VEHICLE_CR',
      label: 'Certificate of Registration (CR)',
      description: 'LTO Certificate of Registration for the tricycle.',
      scope: 'VEHICLE',
      mandatory: true,
      sides: ['FRONT'],
      hasExpiry: false,
      numberField: null,
      publishAsProfilePhoto: false,
      expiryReminderDays: [],
      regulatoryNote: '',
      active: true,
    },
    {
      code: 'FRANCHISE_PERMIT',
      label: 'Tricycle franchise / MTOP',
      description: "Your municipality's tricycle franchise or Motorized Tricycle Operator's Permit.",
      scope: 'VEHICLE',
      mandatory: true,
      sides: ['FRONT'],
      hasExpiry: true,
      numberField: null,
      publishAsProfilePhoto: false,
      expiryReminderDays: [30, 7, 1],
      regulatoryNote:
        'Tricycle franchising is administered by each LGU. Confirm the exact permit name and requirements with every municipality served.',
      active: true,
    },
    {
      code: 'VEHICLE_PHOTO_FRONT',
      label: 'Tricycle photo (front)',
      description: 'Front view showing the plate and body number clearly.',
      scope: 'VEHICLE',
      mandatory: true,
      sides: ['PHOTO'],
      hasExpiry: false,
      numberField: null,
      publishAsProfilePhoto: false,
      expiryReminderDays: [],
      regulatoryNote: '',
      active: true,
    },
    {
      code: 'VEHICLE_PHOTO_SIDE',
      label: 'Tricycle photo (side)',
      description: 'Side view of the tricycle including the sidecar.',
      scope: 'VEHICLE',
      mandatory: true,
      sides: ['PHOTO'],
      hasExpiry: false,
      numberField: null,
      publishAsProfilePhoto: false,
      expiryReminderDays: [],
      regulatoryNote: '',
      active: true,
    },
    {
      code: 'POLICE_CLEARANCE',
      label: 'Police or NBI clearance',
      description: 'Optional unless required by the operator policy.',
      scope: 'DRIVER',
      mandatory: false,
      sides: ['FRONT'],
      hasExpiry: true,
      numberField: null,
      publishAsProfilePhoto: false,
      expiryReminderDays: [14],
      regulatoryNote: 'Operator to decide whether clearance is mandatory.',
      active: true,
    },
  ],
};

/** SAMPLE fare rules. NOT the official Marinduque tricycle fare matrix. */
export const SAMPLE_FARE_CONFIG: FareConfig = {
  label: 'SAMPLE rates — not official, configure before launch',
  isSample: true,
  currency: 'PHP',
  mode: 'DISTANCE',
  baseFare: 2000,
  includedDistanceMeters: 1000,
  perUnitFare: 500,
  unitDistanceMeters: 1000,
  minimumFare: 2000,
  additionalPassengerFare: 1000,
  maxPassengers: 4,
  bookingFee: 0,
  nightSurcharge: { enabled: false, startHour: 22, endHour: 5, percent: 0 },
  rounding: { increment: 100, mode: 'UP' },
  waitingFee: { enabled: false, graceMinutes: 5, perMinute: 100, maxFee: 3000 },
  zones: { definitions: [], fares: [], symmetric: true, fallbackToDistance: true },
  discounts: [
    { code: 'SENIOR', label: 'Senior citizen', percent: 20, enabled: false },
    { code: 'PWD', label: 'Person with disability', percent: 20, enabled: false },
    { code: 'STUDENT', label: 'Student', percent: 20, enabled: false },
  ],
  adjustments: {
    enabled: false,
    maxTotal: 5000,
    reasons: [{ code: 'EXTRA_LUGGAGE', label: 'Extra luggage', maxAmount: 2000 }],
  },
  roadDistanceFactor: 1.3,
};
