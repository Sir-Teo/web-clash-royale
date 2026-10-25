import type { DeckSelection } from "../game/match-decks";

export function copyDeckSelection(selection: DeckSelection): DeckSelection {
  return {
    activeDeck: selection.activeDeck,
    deck: [...selection.deck],
    decks: selection.decks.map((deck) => [...deck]),
  };
}
const signature = (selection: DeckSelection) =>
  JSON.stringify([selection.activeDeck, selection.deck, selection.decks]);
interface Edit {
  before: DeckSelection;
  after: DeckSelection;
  label: string;
  beforeFocus: number;
  afterFocus: number;
}
export interface RestoredDeckEdit {
  selection: DeckSelection;
  label: string;
  focusSlot: number;
}

/** A builder visit owns its edits only while the saved deck state still matches. */
export class DeckEditHistory {
  private past: Edit[] = [];
  private future: Edit[] = [];
  private current: DeckSelection | null = null;
  constructor(private limit = 50) {}
  get undoLabel() {
    return this.past.at(-1)?.label;
  }
  get redoLabel() {
    return this.future.at(-1)?.label;
  }
  reset(selection: DeckSelection) {
    this.past = [];
    this.future = [];
    this.current = copyDeckSelection(selection);
  }
  sync(selection: DeckSelection) {
    if (!this.current) {
      this.reset(selection);
      return false;
    }
    if (signature(selection) === signature(this.current)) return false;
    this.reset(selection);
    return true;
  }
  record(
    before: DeckSelection,
    after: DeckSelection,
    details: Pick<Edit, "label" | "beforeFocus" | "afterFocus">,
  ) {
    this.sync(before);
    if (signature(before) === signature(after)) return false;
    this.past.push({
      before: copyDeckSelection(before),
      after: copyDeckSelection(after),
      label: details.label,
      beforeFocus: details.beforeFocus,
      afterFocus: details.afterFocus,
    });
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    this.current = copyDeckSelection(after);
    return true;
  }
  undo(selection: DeckSelection): RestoredDeckEdit | undefined {
    this.sync(selection);
    const edit = this.past.pop();
    if (!edit) return;
    this.future.push(edit);
    this.current = copyDeckSelection(edit.before);
    return {
      selection: copyDeckSelection(edit.before),
      label: edit.label,
      focusSlot: edit.beforeFocus,
    };
  }
  redo(selection: DeckSelection): RestoredDeckEdit | undefined {
    this.sync(selection);
    const edit = this.future.pop();
    if (!edit) return;
    this.past.push(edit);
    this.current = copyDeckSelection(edit.after);
    return {
      selection: copyDeckSelection(edit.after),
      label: edit.label,
      focusSlot: edit.afterFocus,
    };
  }
}
