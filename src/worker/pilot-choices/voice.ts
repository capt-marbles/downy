import {
  isPilotOptionsRequest,
  pilotVoiceSelection,
  PILOT_OPTIONS,
  type PilotChoice,
  type PilotOptionId,
} from "../../lib/pilot-choices";

export async function handlePilotVoiceRequest(
  transcript: string,
  backend: {
    latest: () => Promise<PilotChoice | null>;
    create: () => Promise<PilotChoice>;
    select: (
      id: string,
      option: PilotOptionId,
    ) => Promise<{ choice: PilotChoice | null; error: string | null }>;
  },
): Promise<string | null> {
  const selection = pilotVoiceSelection(transcript);
  if (selection) {
    const latest = await backend.latest();
    if (!latest)
      return "There are no current CUA option cards. Ask me to show the CUA pilot options first.";
    const result = await backend.select(latest.id, selection);
    if (result.error || result.choice?.selectedId !== selection)
      return `Your new preference was not saved. ${result.error || "Please use the CUA card in chat to try again."}`;
    const title = PILOT_OPTIONS.find(
      (option) => option.id === selection,
    )!.title;
    return `Your preference for ${title} is saved and the card in chat is selected. No research has started. ${selection === "source-comparison" ? "The selected card has three source URL fields. Paste one public source URL into each field and tap Save sources. This only prepares the brief; starting research is a separate step." : "Ask me to prepare the pilot when you are ready."}`;
  }
  if (!isPilotOptionsRequest(transcript)) return null;
  const choice = await backend.create();
  if (choice.selectedId) {
    const title = PILOT_OPTIONS.find(
      (option) => option.id === choice.selectedId,
    )!.title;
    return `The CUA options are in chat, with your saved preference for ${title} selected. ${choice.selectedId === "source-comparison" ? "Its card has three URL fields and a Save sources button for preparing the comparison brief." : "Ask me to prepare that pilot when ready."} No research has started from this chooser.`;
  }
  return `I've put three CUA pilot options in chat: read one public page, compare three sources, or test recovery from a broken link. Tell me which you choose, or tap a card, to save your preference. Nothing starts until you ask. ${choice.composition.state === "fallback" ? "The layout service was unavailable, so I used a standard list." : ""}`;
}
