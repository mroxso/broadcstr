import { relayInit } from 'nostr-tools'

export class BroadcstrPool {
    _conn = {};
    _seenOn = {};

    normalizeURL = url => {
        let p = new URL(url)
        p.pathname = p.pathname.replace(/\/+/g, '/')
        if (p.pathname.endsWith('/')) p.pathname = p.pathname.slice(0, -1)
        if (
            (p.port === '80' && p.protocol === 'ws:') ||
            (p.port === '443' && p.protocol === 'wss:')
        )
            p.port = ''
        p.searchParams.sort()
        p.hash = ''
        return p.toString()
    }

    checkConnectingRelay = relay => {
        return new Promise((resolve, reject) => {
            if (!relay)
                reject("No relay");
            setTimeout(() => {
                resolve(true);
            }, 10000)
        })
    }

    ensureRelay = async url => {
        const normalizedUrl = this.normalizeURL(url);
        const existing = this._conn[normalizedUrl];
        if (existing)
            if (existing.status !== 3)
                return existing;
        const relay = relayInit(normalizedUrl);
        this._conn[normalizedUrl] = relay;
        await relay.connect();
        await this.checkConnectingRelay(relay);
        return relay;
    }

    sub = (relayUrls, filters, options) => {
        let _knownEvents = {};
        let modifiedOptions = options || {};
        modifiedOptions.alreadyHaveEvent = (id, url) => {
            return Object.keys(_knownEvents).includes(id);
        }
        let subs = [];
        let eventListeners = {};
        let eoseListeners = {};
        let eosesMissing = relayUrls.length;
        let eoseSent = false;
        let eoseTimeout = setTimeout(() => {
            eoseSent = true;
            Object.keys(eoseListeners).forEach(k => {
                eoseListeners[k]();
            });
        }, 2400);
        relayUrls.forEach(async url => {
            let r = await this.ensureRelay(url);
            if (!r) return;
            let s = r.sub(filters, modifiedOptions)
            s.on('event', event => {
                _knownEvents[event.id] = event;
                Object.keys(eventListeners).forEach(k => {
                    eventListeners[k](event);
                })
            });
            s.on('eose', () => {
                if (eoseSent) return;
                eosesMissing--;
                if (eosesMissing === 0) {
                    clearTimeout(eoseTimeout);
                    Object.keys(eoseListeners).forEach(k => {
                        eoseListeners[k]();
                    })
                }
            })
            subs.push(s);
        });

        let greaterSub = {
            sub: (filters, options) => {
                subs.forEach(sub => {
                    sub.sub(filters, options);
                })
            },
            unsub: () => {
                subs.forEach(sub => sub.unsub());
            },
            on: (type, callback) => {
                switch (type) {
                    case 'event':
                        eventListeners[type] = callback;
                        break;
                    case 'eose':
                        eoseListeners[type] = callback;
                        break;
                    default:
                }
            },
            off: (type, callback) => {
                if (type === 'event') {
                    delete eventListeners[callback]
                }
            }
        }
        return greaterSub;

    }
    list = (relaysUrls, filters, options) => {
        return new Promise(resolve => {
            let events = [];
            let sub = this.sub(relaysUrls, filters, options);
            sub.on('event', event => {
                events.push(event);
            })
            sub.on('eose', () => {
                sub.unsub();
                resolve(events);
            })
        });
    }

    close = relaysUrls => {
        relaysUrls.forEach(url => {
            let relay = this._conn[this.normalizeURL(url)]
            if (relay) relay.close()
        })
    }

    publish = (relaysUrls, event) => {
        return relaysUrls.map(url => {
            let r = this._conn[this.normalizeURL(url)]
            if (!r) return this.badPub(url)
            let s = r.publish(event)
            return s
        })
    }
    
    badPub = (relayUrl) => {
        return {
            on(typ, cb) {
                if (typ === 'failed') cb(`relay ${relayUrl} not connected`)
            },
            off() { }
        }
    }
}
/*const _conn 
  private _conn: { [url: string]: Relay }
  private _seenOn: { [id: string]: Set < string >} = { } // a map of all events we've seen in each relay

constructor() {
    this._conn = {}
}

close(relays: string[]): void {
    relays.map(url => {
        let relay = this._conn[normalizeURL(url)]
        if (relay) relay.close()
    })
}

  async ensureRelay(url: string): Promise < Relay > {
    const nm = normalizeURL(url)
    const existing = this._conn[nm]
    if(existing) return existing

    const relay = relayInit(nm)
    this._conn[nm] = relay

    await relay.connect()

    return relay
}

sub(relays: string[], filters: Filter[], opts ?: SubscriptionOptions): Sub {
    let _knownIds: Set<string> = new Set()
    let modifiedOpts = opts || {}
    modifiedOpts.alreadyHaveEvent = (id, url) => {
        let set = this._seenOn[id] || new Set()
        set.add(url)
        this._seenOn[id] = set
        return _knownIds.has(id)
    }

    let subs: Sub[] = []
    let eventListeners: Set<(event: Event) => void> = new Set()
    let eoseListeners: Set<() => void> = new Set()
    let eosesMissing = relays.length

    let eoseSent = false
    let eoseTimeout = setTimeout(() => {
        eoseSent = true
        for (let cb of eoseListeners.values()) cb()
    }, 2400)

    relays.forEach(async relay => {
        let r = await this.ensureRelay(relay)
        if (!r) return
        let s = r.sub(filters, modifiedOpts)
        s.on('event', (event: Event) => {
            _knownIds.add(event.id as string)
            for (let cb of eventListeners.values()) cb(event)
        })
        s.on('eose', () => {
            if (eoseSent) return

            eosesMissing--
            if (eosesMissing === 0) {
                clearTimeout(eoseTimeout)
                for (let cb of eoseListeners.values()) cb()
            }
        })
        subs.push(s)
    })

    let greaterSub: Sub = {
        sub(filters, opts) {
            subs.forEach(sub => sub.sub(filters, opts))
            return greaterSub
        },
        unsub() {
            subs.forEach(sub => sub.unsub())
        },
        on(type, cb) {
            switch (type) {
                case 'event':
                    eventListeners.add(cb)
                    break
                case 'eose':
                    eoseListeners.add(cb)
                    break
            }
        },
        off(type, cb) {
            if (type === 'event') {
                eventListeners.delete(cb)
            } else if (type === 'eose') eoseListeners.delete(cb)
        }
    }

    return greaterSub
}

get(
    relays: string[],
    filter: Filter,
    opts ?: SubscriptionOptions
): Promise < Event | null > {
    return new Promise(resolve => {
        let sub = this.sub(relays, [filter], opts)
        let timeout = setTimeout(() => {
            sub.unsub()
            resolve(null)
        }, 1500)
        sub.on('event', (event: Event) => {
            resolve(event)
            clearTimeout(timeout)
            sub.unsub()
        })
    })
}

list(
    relays: string[],
    filters: Filter[],
    opts ?: SubscriptionOptions
): Promise < Event[] > {
    return new Promise(resolve => {
        let events: Event[] = []
        let sub = this.sub(relays, filters, opts)

        sub.on('event', (event: Event) => {
            events.push(event)
        })

        // we can rely on an eose being emitted here because pool.sub() will fake one
        sub.on('eose', () => {
            sub.unsub()
            resolve(events)
        })
    })
}

publish(relays: string[], event: Event): Pub[] {
    return relays.map(relay => {
        let r = this._conn[normalizeURL(relay)]
        if (!r) return badPub(relay)
        let s = r.publish(event)
        return s
    })
}

seenOn(id: string): string[] {
    return Array.from(this._seenOn[id]?.values?.() || [])
}
}

function badPub(relay: string): Pub {
    return {
        on(typ, cb) {
            if (typ === 'failed') cb(`relay ${relay} not connected`)
        },
        off() { }
    }
}*/
