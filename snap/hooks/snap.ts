function pad(n: number): string {
  return String(n).padStart(2, '0')
}

// ~/.cache/claude-snaps/snap-YYYYMMDD-HHMMSS.png in local time.
export function snapFile(home: string, nowMs: number): string {
  const d = new Date(nowMs)
  const day = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  return `${home}/.cache/claude-snaps/snap-${day}-${time}.png`
}

export function snapArgv(file: string): string[] {
  return ['spectacle', '--region', '--background', '--nonotify', '--output', file]
}
