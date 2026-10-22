/**
 * GrabCycle Cloud Functions entry point.
 *
 * Every exported name below is a deployed function. Callable names are what
 * the Android app and admin dashboard invoke; keep them stable.
 */
import { setGlobalOptions } from 'firebase-functions/v2';
import { FUNCTIONS_REGION } from './lib/params';

setGlobalOptions({ region: FUNCTIONS_REGION, maxInstances: 20, concurrency: 40 });

import * as account from './handlers/account';
import * as adminH from './handlers/admin';
import * as driver from './handlers/driver';
import * as ride from './handlers/ride';
import * as schedules from './handlers/schedules';

// Accounts & passenger verification
export const completeRegistration = account.completeRegistrationFn;
export const updateProfile = account.updateProfileFn;
export const registerDevice = account.registerDeviceFn;
export const unregisterDevice = account.unregisterDeviceFn;
export const requestDataAction = account.requestDataActionFn;
export const submitPassengerVerification = account.submitPassengerVerificationFn;

// Driver onboarding & availability
export const saveDriverProfile = driver.saveDriverProfileFn;
export const submitDriverDocument = driver.submitDriverDocumentFn;
export const submitDriverApplication = driver.submitDriverApplicationFn;
export const refreshDriverEligibility = driver.refreshDriverEligibilityFn;
export const setDriverAvailability = driver.setDriverAvailabilityFn;

// Places, fares, discovery, rides
export const searchPlaces = ride.searchPlacesFn;
export const reverseGeocode = ride.reverseGeocodeFn;
export const getFareQuote = ride.getFareQuoteFn;
export const findNearbyDrivers = ride.findNearbyDriversFn;
export const createRide = ride.createRideFn;
export const refreshRide = ride.refreshRideFn;
export const cancelRide = ride.cancelRideFn;
export const respondToOffer = ride.respondToOfferFn;
export const updateRideProgress = ride.updateRideProgressFn;
export const completeRide = ride.completeRideFn;
export const recordCashPayment = ride.recordCashPaymentFn;
export const disputePayment = ride.disputePaymentFn;
export const submitRating = ride.submitRatingFn;
export const createSupportCase = ride.createSupportCaseFn;

// Administration (server-enforced staff permissions)
export const adminClaimVerificationCase = adminH.adminClaimVerificationCaseFn;
export const adminDecidePassengerVerification = adminH.adminDecidePassengerVerificationFn;
export const adminUpdatePassengerVerification = adminH.adminUpdatePassengerVerificationFn;
export const adminReviewDriverDocument = adminH.adminReviewDriverDocumentFn;
export const adminReviewVehicle = adminH.adminReviewVehicleFn;
export const adminDecideDriver = adminH.adminDecideDriverFn;
export const adminGetDocumentFile = adminH.adminGetDocumentFileFn;
export const adminSetAccountStatus = adminH.adminSetAccountStatusFn;
export const adminSetFareDiscount = adminH.adminSetFareDiscountFn;
export const adminSetStaffRole = adminH.adminSetStaffRoleFn;
export const adminGetOverview = adminH.adminGetOverviewFn;
export const adminUpdateConfig = adminH.adminUpdateConfigFn;
export const adminPublishFareConfig = adminH.adminPublishFareConfigFn;
export const adminActivateFareVersion = adminH.adminActivateFareVersionFn;
export const adminUpsertLandmark = adminH.adminUpsertLandmarkFn;
export const adminCancelRide = adminH.adminCancelRideFn;
export const adminCompleteRide = adminH.adminCompleteRideFn;
export const adminResolvePayment = adminH.adminResolvePaymentFn;
export const adminUpdateSupportCase = adminH.adminUpdateSupportCaseFn;
export const adminExportUserData = adminH.adminExportUserDataFn;
export const adminResolveDataRequest = adminH.adminResolveDataRequestFn;
export const adminDeleteUserData = adminH.adminDeleteUserDataFn;

// Scheduled jobs
export const sweepRidesJob = schedules.sweepRidesJob;
export const sweepDriversJob = schedules.sweepDriversJob;
export const documentExpiryJob = schedules.documentExpiryJob;
export const expiryRemindersJob = schedules.expiryRemindersJob;
export const maintenanceJob = schedules.maintenanceJob;
