// Each editor window keeps its own opening order for the lifetime of the window.
export class RecentNotes {
  private order: string[] = [];
  private cycle: string[] | null = null;
  private lastPress = -Infinity;

  opened(id: string | null, cycling = false): void {
    if (!cycling) this.cycle = null;
    if (id) this.order = [id, ...this.order.filter((other) => other !== id)];
  }

  rename(from: string, to: string): void {
    const replace = (ids: string[]) => [...new Set(ids.map((id) => id === from ? to : id))];
    this.order = replace(this.order);
    if (this.cycle) this.cycle = replace(this.cycle);
  }

  next(current: string | null, available: string[], now: number): string | undefined {
    const exists = new Set(available);
    this.order = this.order.filter((id) => exists.has(id));
    if (!this.cycle || now - this.lastPress >= 1000) this.cycle = [...this.order];
    this.cycle = this.cycle.filter((id) => exists.has(id));
    this.lastPress = now;
    const index = current ? this.cycle.indexOf(current) : -1;
    const next = this.cycle[(index + 1) % this.cycle.length];
    return next === current ? undefined : next;
  }
}
