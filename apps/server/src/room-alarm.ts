type AlarmStorage = Pick<DurableObjectTransaction, 'getAlarm' | 'setAlarm'>

/** Presence, queue retries and run watchdogs share one alarm. Never postpone it. */
export async function scheduleEarlierAlarm(storage: AlarmStorage, at: number) {
  const current = await storage.getAlarm()
  if (current === null || at < current) await storage.setAlarm(at)
}

export function scheduleRoomAlarm(storage: DurableObjectStorage, at: number) {
  return storage.transaction((tx) => scheduleEarlierAlarm(tx, at))
}
