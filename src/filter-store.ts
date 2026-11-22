// State of the "Workflows only" filter, including saving it. At most one write runs at a time;
// the latest choice is written afterwards. No outdated response can therefore separate the
// display from the saved value.

export const SAVE_ERROR = 'Could not save the filter'

export class FilterStore {
  /** What the panel shows. */
  shown: boolean
  error: string | null = null
  /** Last value confirmed as saved. */
  private saved: boolean
  private writing = false
  private chosen = false

  constructor(
    initial: boolean,
    private readonly write: (value: boolean) => Promise<void>,
    private readonly onChange: (shown: boolean, error: string | null) => void
  ) {
    this.shown = initial
    this.saved = initial
  }

  /** The value from plugin storage; a choice the user already made takes precedence. */
  loaded(value: boolean): void {
    this.saved = value
    if (this.chosen) return
    this.shown = value
    this.onChange(this.shown, this.error)
  }

  choose(value: boolean): void {
    this.chosen = true
    this.shown = value
    this.onChange(this.shown, this.error)
    this.flush()
  }

  private flush(): void {
    if (this.writing || this.shown === this.saved) return
    const value = this.shown
    this.writing = true
    this.write(value).then(
      () => {
        this.writing = false
        this.saved = value
        if (this.shown === this.saved) {
          if (this.error !== null) {
            this.error = null
            this.onChange(this.shown, this.error)
          }
          return
        }
        this.flush()
      },
      (cause: unknown) => {
        this.writing = false
        this.shown = this.saved
        this.error = `${SAVE_ERROR}: ${cause instanceof Error ? cause.message : String(cause)}`
        this.onChange(this.shown, this.error)
      }
    )
  }
}
