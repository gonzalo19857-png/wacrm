"use client";

import { Smile } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * A curated, hand-picked emoji set grouped the way most chat apps present
 * them. Deliberately not the full Unicode emoji list — enough everyday
 * coverage for chat replies without pulling in a full emoji-picker library
 * (the `QUICK_EMOJIS` set in message-actions.tsx made the same trade-off
 * for reactions; this just needs broader coverage since it composes
 * free-form text rather than a single reaction).
 */
const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  {
    label: "Smileys & people",
    emojis: [
      "😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂", "🙃",
      "😉", "😊", "😇", "🥰", "😍", "🤩", "😘", "😋", "😛", "🤪",
      "🤑", "🤗", "🤭", "🤫", "🤔", "🤐", "😐", "😑", "😶", "😏",
      "😒", "🙄", "😬", "😌", "😔", "😪", "🤤", "😴", "😷", "🤒",
      "🥵", "🥶", "😵", "🤯", "🤠", "🥳", "🥺", "😎", "🤓", "🧐",
      "😕", "🙁", "😮", "😲", "😳", "🥱", "😦", "😨", "😰", "😢",
      "😭", "😱", "😖", "😞", "😩", "😫", "😤", "😡", "🤬", "😈",
    ],
  },
  {
    label: "Gestures & hands",
    emojis: [
      "👋", "🤚", "✋", "👌", "🤌", "🤏", "✌️", "🤞", "🤟", "🤘",
      "🤙", "👈", "👉", "👆", "👇", "☝️", "👍", "👎", "✊", "👊",
      "👏", "🙌", "👐", "🙏", "✍️", "💪",
    ],
  },
  {
    label: "Hearts",
    emojis: [
      "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔",
      "❣️", "💕", "💞", "💓", "💗", "💖", "💘", "💝",
    ],
  },
  {
    label: "Animals & nature",
    emojis: [
      "🐶", "🐱", "🐭", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯", "🦁",
      "🐮", "🐷", "🐸", "🐵", "🐔", "🐧", "🐦", "🦆", "🦉", "🐺",
      "🐴", "🦄", "🐝", "🦋", "🐢", "🐍", "🐙", "🦀", "🐠", "🐬",
      "🐳", "🌵", "🌲", "🌴", "🌸", "🌻", "🌹", "🍀", "🌈", "☀️",
      "⭐", "🌙", "☁️", "⚡", "🔥", "💧",
    ],
  },
  {
    label: "Food & drink",
    emojis: [
      "🍏", "🍎", "🍊", "🍋", "🍌", "🍉", "🍇", "🍓", "🍑", "🥭",
      "🍍", "🥥", "🥝", "🍅", "🥑", "🥔", "🌽", "🌶️", "🍞", "🧀",
      "🍗", "🍔", "🍟", "🍕", "🌮", "🌯", "🍜", "🍣", "🍩", "🍪",
      "🎂", "🍰", "🍫", "🍿", "🍺", "🥂", "🍷", "☕", "🍵", "🥤",
    ],
  },
  {
    label: "Objects & symbols",
    emojis: [
      "🎉", "🎊", "🎁", "🏆", "🥇", "⚽", "🏀", "🎵", "🎶", "📱",
      "💻", "📷", "💡", "🔑", "🔒", "🔔", "💰", "💵", "💳", "✉️",
      "📩", "📅", "⏰", "✅", "❌", "❓", "❗", "⚠️", "🔄", "🆗",
      "🆕",
    ],
  },
];

interface EmojiPickerProps {
  /** Called with the picked emoji. The picker stays open afterward so an
   *  agent can drop in several in a row, the way WhatsApp's own picker
   *  does — closing on every pick would mean re-opening for each one. */
  onPick: (emoji: string) => void;
  disabled?: boolean;
  title?: string;
}

export function EmojiPicker({ onPick, disabled, title }: EmojiPickerProps) {
  return (
    <Popover>
      <PopoverTrigger
        disabled={disabled}
        title={title}
        aria-label={title}
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md p-0 text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Smile className="h-4 w-4" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        className="max-h-72 w-72 overflow-y-auto"
      >
        {EMOJI_GROUPS.map((group) => (
          <div key={group.label} className="mb-2 last:mb-0">
            <p className="mb-1 px-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {group.label}
            </p>
            <div className="grid grid-cols-8">
              {group.emojis.map((emoji, i) => (
                <button
                  key={`${emoji}-${i}`}
                  type="button"
                  onClick={() => onPick(emoji)}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-base leading-none transition-transform hover:scale-125 hover:bg-muted"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}
