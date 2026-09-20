/** Safe, code-owned diagnostics; never pass arbitrary provider errors to chat. */
export class ComparisonDraftError extends Error {
  constructor(public readonly code: "length" | "empty" | "json" | "schema") {
    super(
      {
        length:
          "The drafting model reached its output limit before completing the report. Jev has not evaluated it.",
        empty:
          "The drafting model returned no report text. Jev has not evaluated it.",
        json: "The drafting model returned incomplete or invalid JSON. Jev has not evaluated it.",
        schema:
          "The drafting model returned findings that do not match the required citation format. Jev has not evaluated them.",
      }[code],
    );
  }
}
