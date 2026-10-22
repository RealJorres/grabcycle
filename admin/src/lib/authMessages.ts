/** Maps Firebase Auth codes without revealing whether an email is registered. */
export function signInMessage(code: string): string {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-email':
      return 'Incorrect email or password.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Try again later or reset your password.';
    case 'auth/user-disabled':
      return 'This account is disabled. Contact a GrabCycle superadmin.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection.';
    case 'auth/multi-factor-auth-required':
      return 'This account requires a second factor, which this dashboard does not support yet. Contact a superadmin.';
    default:
      return 'Sign-in failed. Try again.';
  }
}
