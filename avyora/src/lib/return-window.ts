export const RETURN_WINDOW_DAYS = 15;

export function isWithinReturnWindow(deliveredAt: Date | null | undefined, now = new Date()): boolean {
  if (!deliveredAt) return false;
  const deadline = new Date(deliveredAt);
  deadline.setDate(deadline.getDate() + RETURN_WINDOW_DAYS);
  return now.getTime() <= deadline.getTime();
}

export function returnWindowDeadline(deliveredAt: Date): Date {
  const deadline = new Date(deliveredAt);
  deadline.setDate(deadline.getDate() + RETURN_WINDOW_DAYS);
  return deadline;
}
