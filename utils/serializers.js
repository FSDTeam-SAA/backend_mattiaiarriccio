export const publicUser = (user) => {
  if (!user) {
    return null;
  }

  return {
    id: user._id,
    role: user.role,
    username: user.firstName,
    userName: user.firstName,
    firstName: user.firstName,
    lastName: user.lastName,
    fullName: user.fullName,
    email: user.email,
    phoneNumber: user.phoneNumber,
    avatarUrl: user.avatarUrl,
    preferredLanguage: user.preferredLanguage,
    notificationsEnabled: user.notificationsEnabled,
    onboardingCompleted: user.onboardingCompleted,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
};
