import {setTimeout as wait} from 'node:timers/promises';
import type {Sequelize} from 'sequelize';
import {getDebug} from './tools/getDebug';

const debug = getDebug('app:DatabaseHealth');

export const databaseDialectOptions = {socketTimeout: 30_000};

class DatabaseHealth {
  private available?: boolean;
  private readonly controller = new AbortController();
  private startPromise?: Promise<void>;
  private monitorPromise?: Promise<void>;

  constructor(
    private readonly sequelize: Pick<Sequelize, 'authenticate'>,
    private readonly intervalMs = 10_000,
  ) {}

  get isAvailable() {
    return this.available === true && !this.controller.signal.aborted;
  }

  start(): Promise<void> {
    this.startPromise ??= this.startOnce();
    return this.startPromise;
  }

  async stop() {
    this.controller.abort();
    await Promise.allSettled([this.startPromise, this.monitorPromise]);
  }

  private async check() {
    if (this.controller.signal.aborted) return;
    try {
      await this.sequelize.authenticate({retry: {max: 0}});
      this.setAvailable(true);
    } catch {
      this.setAvailable(false);
    }
  }

  private async startOnce() {
    while (!this.controller.signal.aborted) {
      await this.check();
      if (this.isAvailable) {
        this.monitorPromise = this.monitor();
        return;
      }
      await this.pause();
    }
    this.controller.signal.throwIfAborted();
  }

  private async monitor() {
    while (!this.controller.signal.aborted) {
      await this.pause();
      await this.check();
    }
  }

  private async pause() {
    const {signal} = this.controller;
    try {
      await wait(this.intervalMs, undefined, {signal});
    } catch (error) {
      if (!signal.aborted) throw error;
    }
  }

  private setAvailable(available: boolean) {
    if (this.controller.signal.aborted) return;
    if (this.available === available) return;
    this.available = available;
    debug(available ? 'Database available' : 'Database unavailable; application work paused');
  }
}

export default DatabaseHealth;
