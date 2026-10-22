import { z } from 'zod';
import { isValidDateString } from './dates';

/**
 * Runtime-configurable operating parameters.
 *
 * All values are stored in Firestore (`config/*`, `fareConfigs/*`) and edited
 * by administrators through validated Cloud Functions. Nothing here is a
 * regulatory fact: the seeded values are SAMPLES that the operator must
 * replace after confirming requirements with LTO, LTFRB and the relevant
 * Marinduque LGUs (see docs/production-checklist.md).
 */

const latLngTuple = z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]);
const polygon = z.array(latLngTuple).min(3).max(500);
const centavos = z.number().int().min(0).max(10_000_000);

// ---------------------------------------------------------------------------
// Service area
// ---------------------------------------------------------------------------
export const serviceAreaSchema = z.object({
  name: z.string().min(1).max(100),
  /** One or more polygons (main island plus smaller islands). */
  polygons: z.array(polygon).min(1).max(50),
  municipalities: z.array(z.string().min(1).max(60)).max(100),
  /** Margin (degrees) added around the polygons for the RTDB write bounds. */
  boundsMarginDeg: z.number().min(0).max(1),
  operatingHours: z.object({
    enabled: z.boolean(),
    /** Local (Asia/Manila) hour range; start > end means overnight service. */
    startHour: z.number().int().min(0).max(23),
    endHour: z.number().int().min(0).max(24),
  }),
  isSample: z.boolean(),
});
export type ServiceAreaConfig = z.infer<typeof serviceAreaSchema>;

// ---------------------------------------------------------------------------
// Matching & location policy
// ---------------------------------------------------------------------------
export const matchingSchema = z
  .object({
    initialRadiusM: z.number().int().min(200).max(20_000),
    radiusStepM: z.number().int().min(100).max(10_000),
    maxRadiusM: z.number().int().min(200).max(30_000),
    locationFreshnessSec: z.number().int().min(5).max(300),
    maxLocationAccuracyM: z.number().int().min(5).max(1000),
    locationUpdateIntervalSec: z.number().int().min(2).max(60),
    offerTimeoutSec: z.number().int().min(10).max(120),
    searchTimeoutSec: z.number().int().min(30).max(900),
    maxCandidates: z.number().int().min(1).max(30),
    maxDiscoveryResults: z.number().int().min(1).max(50),
    arrivalMaxDistanceM: z.number().int().min(50).max(5000),
    staleDriverAutoOfflineMin: z.number().int().min(2).max(120),
    missedOffersBeforeOffline: z.number().int().min(1).max(20),
    quoteTtlSec: z.number().int().min(60).max(3600),
    rejectMockLocations: z.boolean(),
  })
  .refine((m) => m.maxRadiusM >= m.initialRadiusM, { message: 'maxRadiusM must be >= initialRadiusM' });
export type MatchingConfig = z.infer<typeof matchingSchema>;

// ---------------------------------------------------------------------------
// Fare rules (versioned; each published version is immutable)
// ---------------------------------------------------------------------------
export const fareConfigSchema = z
  .object({
    label: z.string().min(1).max(120),
    /** True for development sample rates. The quote UI displays a warning. */
    isSample: z.boolean(),
    currency: z.literal('PHP'),
    mode: z.enum(['DISTANCE', 'ZONE']),
    baseFare: centavos,
    includedDistanceMeters: z.number().int().min(0).max(100_000),
    perUnitFare: centavos,
    unitDistanceMeters: z.number().int().min(100).max(10_000),
    minimumFare: centavos,
    additionalPassengerFare: centavos,
    maxPassengers: z.number().int().min(1).max(8),
    bookingFee: centavos,
    nightSurcharge: z.object({
      enabled: z.boolean(),
      startHour: z.number().int().min(0).max(23),
      endHour: z.number().int().min(0).max(23),
      percent: z.number().min(0).max(100),
    }),
    rounding: z.object({
      increment: z.number().int().min(1).max(1000),
      mode: z.enum(['NEAREST', 'UP']),
    }),
    waitingFee: z.object({
      enabled: z.boolean(),
      graceMinutes: z.number().int().min(0).max(60),
      perMinute: centavos,
      maxFee: centavos,
    }),
    zones: z.object({
      definitions: z
        .array(z.object({ id: z.string().min(1).max(40), name: z.string().min(1).max(80), polygon }))
        .max(100),
      fares: z.array(z.object({ from: z.string(), to: z.string(), fare: centavos })).max(2000),
      symmetric: z.boolean(),
      fallbackToDistance: z.boolean(),
    }),
    discounts: z
      .array(
        z.object({
          code: z.string().regex(/^[A-Z_]{2,20}$/),
          label: z.string().min(1).max(80),
          percent: z.number().min(0).max(100),
          enabled: z.boolean(),
        }),
      )
      .max(10),
    adjustments: z.object({
      enabled: z.boolean(),
      maxTotal: centavos,
      reasons: z
        .array(z.object({ code: z.string().regex(/^[A-Z_]{2,30}$/), label: z.string().min(1).max(80), maxAmount: centavos }))
        .max(20),
    }),
    /** Multiplier applied to straight-line distance when no road route is available. */
    roadDistanceFactor: z.number().min(1).max(3),
  })
  .refine((f) => f.mode !== 'ZONE' || f.zones.definitions.length > 0, {
    message: 'ZONE mode requires at least one zone definition',
  });
export type FareConfig = z.infer<typeof fareConfigSchema>;

// ---------------------------------------------------------------------------
// Document policy
// ---------------------------------------------------------------------------
const side = z.enum(['FRONT', 'BACK', 'PHOTO']);

export const driverRequirementSchema = z.object({
  code: z.string().regex(/^[A-Z0-9_]{2,40}$/),
  label: z.string().min(1).max(100),
  description: z.string().max(500),
  scope: z.enum(['DRIVER', 'VEHICLE']),
  mandatory: z.boolean(),
  sides: z.array(side).min(1).max(3),
  hasExpiry: z.boolean(),
  /** Optional reference number captured with the document (e.g. licence number). */
  numberField: z
    .object({ label: z.string().min(1).max(60), pattern: z.string().max(200), required: z.boolean() })
    .nullable(),
  /** When approved, the photo is copied to public storage (profile photo only). */
  publishAsProfilePhoto: z.boolean(),
  /** Remind drivers this many days before expiry. */
  expiryReminderDays: z.array(z.number().int().min(1).max(365)).max(5),
  regulatoryNote: z.string().max(500),
  active: z.boolean(),
});
export type DriverRequirement = z.infer<typeof driverRequirementSchema>;

export const passengerIdTypeSchema = z.object({
  code: z.string().regex(/^[A-Z0-9_]{2,40}$/),
  label: z.string().min(1).max(100),
  sides: z.array(z.enum(['FRONT', 'BACK'])).min(1).max(2),
  hasExpiry: z.boolean(),
  active: z.boolean(),
});
export type PassengerIdType = z.infer<typeof passengerIdTypeSchema>;

export const documentPolicySchema = z
  .object({
    passengerIdTypes: z.array(passengerIdTypeSchema).min(1).max(30),
    driverRequirements: z.array(driverRequirementSchema).min(1).max(30),
    /** Days an approved passenger verification stays valid; null = indefinitely (subject to ID expiry). */
    passengerApprovalValidityDays: z.number().int().min(30).max(3650).nullable(),
    maxUploadBytes: z.number().int().min(100_000).max(6 * 1024 * 1024),
    privacyNoticeVersion: z.string().min(1).max(20),
    isSample: z.boolean(),
  })
  .refine((p) => new Set(p.driverRequirements.map((r) => r.code)).size === p.driverRequirements.length, {
    message: 'Duplicate driver requirement code',
  })
  .refine((p) => new Set(p.passengerIdTypes.map((r) => r.code)).size === p.passengerIdTypes.length, {
    message: 'Duplicate passenger ID type code',
  });
export type DocumentPolicy = z.infer<typeof documentPolicySchema>;

// ---------------------------------------------------------------------------
// Operating policies (cancellation, ratings, retention)
// ---------------------------------------------------------------------------
export const policiesSchema = z.object({
  cancellation: z.object({
    /** Cancellation fees are disabled until the operator defines and discloses a policy. */
    passengerFeeEnabled: z.boolean(),
    passengerFee: centavos,
    passengerFeeAfterAcceptMinutes: z.number().int().min(0).max(60),
    driverNoShowWaitMinutes: z.number().int().min(1).max(60),
  }),
  ratings: z.object({
    minRatingsToDisplay: z.number().int().min(1).max(100),
    ratingWindowDays: z.number().int().min(1).max(30),
  }),
  retention: z.object({
    rideRecordsDays: z.number().int().min(30).max(3650),
    rejectedDocumentsDays: z.number().int().min(1).max(3650),
    stagingUploadsHours: z.number().int().min(1).max(168),
    auditLogDays: z.number().int().min(90).max(3650),
  }),
  terms: z.object({
    termsVersion: z.string().min(1).max(20),
    privacyNoticeVersion: z.string().min(1).max(20),
  }),
});
export type PoliciesConfig = z.infer<typeof policiesSchema>;

export const paymentsSchema = z.object({
  enabledMethods: z.array(z.enum(['CASH'])).min(1),
  /** Allowed shortfall (centavos) before a cash payment is flagged as a discrepancy. */
  cashDiscrepancyTolerance: centavos,
});
export type PaymentsConfig = z.infer<typeof paymentsSchema>;

export const appConfigSchema = z.object({
  announcements: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        title: z.string().min(1).max(120),
        body: z.string().min(1).max(1000),
        audience: z.enum(['ALL', 'PASSENGER', 'DRIVER']),
        active: z.boolean(),
        startsAt: z.string().refine(isValidDateString).nullable(),
        endsAt: z.string().refine(isValidDateString).nullable(),
      }),
    )
    .max(20),
  supportPhone: z.string().max(30),
  supportEmail: z.string().max(120),
  emergencyHotline: z.string().max(20),
  minAndroidVersionCode: z.number().int().min(0),
  maintenanceMode: z.boolean(),
});
export type AppConfig = z.infer<typeof appConfigSchema>;

export const CONFIG_SCHEMAS = {
  serviceArea: serviceAreaSchema,
  matching: matchingSchema,
  documentPolicy: documentPolicySchema,
  policies: policiesSchema,
  payments: paymentsSchema,
  app: appConfigSchema,
} as const;
export type ConfigKey = keyof typeof CONFIG_SCHEMAS;
export const CONFIG_KEYS = Object.keys(CONFIG_SCHEMAS) as ConfigKey[];

export interface ConfigTypes {
  serviceArea: ServiceAreaConfig;
  matching: MatchingConfig;
  documentPolicy: DocumentPolicy;
  policies: PoliciesConfig;
  payments: PaymentsConfig;
  app: AppConfig;
}
