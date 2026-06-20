/*  nodejs-poolController.  An application to control pool equipment.
Copyright (C) 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026.
Russell Goldin, tagyoureit.  russ.goldin@gmail.com

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/
import * as dgram from 'dgram';
import { EventEmitter } from 'events';

// Minimal, dependency-free SSDP/UPnP advertiser.  Replaces the abandoned
// `node-ssdp` package (which carried an unfixable SSRF advisory via its
// unmaintained `ip` dependency).  It implements only what njsPC needs:
//  - responds to M-SEARCH discovery requests for our advertised targets
//  - periodically multicasts `ssdp:alive` NOTIFY announcements
//  - multicasts `ssdp:byebye` on shutdown
// See UPnP Device Architecture 1.1 §1 (Discovery) for the wire format.
const SSDP_MULTICAST_ADDR = '239.255.255.250';
const SSDP_PORT = 1900;

export interface SsdpServerOptions {
    // Unique Device Name, e.g. `uuid:806f52f4-...`.
    udn: string;
    // Absolute URL to the device description document (upnp.xml).
    location: string;
    // Source port to bind (node-ssdp defaulted to 1900).
    sourcePort?: number;
    // Max-age advertised to control points and the re-announce cadence basis.
    ttl?: number;
}

export class SsdpServer extends EventEmitter {
    private socket: dgram.Socket | undefined;
    private usns: string[] = [];
    private aliveTimer: NodeJS.Timeout | undefined;
    private readonly udn: string;
    private readonly location: string;
    private readonly sourcePort: number;
    private readonly ttl: number;
    private started = false;
    constructor(opts: SsdpServerOptions) {
        super();
        this.udn = opts.udn;
        this.location = opts.location;
        this.sourcePort = opts.sourcePort || SSDP_PORT;
        this.ttl = opts.ttl || 1800;
    }
    // Register an advertised search target (e.g. `upnp:rootdevice` or the device type urn).
    public addUSN(target: string) {
        if (this.usns.indexOf(target) === -1) this.usns.push(target);
    }
    public start(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            try {
                const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
                this.socket = socket;
                socket.on('error', (err) => this.emit('error', err));
                socket.on('message', (msg, rinfo) => this.onMessage(msg, rinfo));
                socket.on('listening', () => {
                    try {
                        socket.addMembership(SSDP_MULTICAST_ADDR);
                        socket.setMulticastTTL(4);
                    } catch (err) { this.emit('error', err); }
                    this.started = true;
                    this.sendAlive();
                    // Re-announce at roughly half the advertised max-age, as UPnP recommends.
                    this.aliveTimer = setInterval(() => this.sendAlive(), Math.max(this.ttl / 2, 30) * 1000);
                    if (this.aliveTimer.unref) this.aliveTimer.unref();
                    resolve();
                });
                socket.bind(this.sourcePort);
            } catch (err) { reject(err); }
        });
    }
    // Build the full list of advertised (ST, USN) pairs, including the bare UDN.
    private targets(): { st: string, usn: string }[] {
        const pairs: { st: string, usn: string }[] = [{ st: this.udn, usn: this.udn }];
        for (const target of this.usns) pairs.push({ st: target, usn: `${this.udn}::${target}` });
        return pairs;
    }
    private onMessage(msg: Buffer, rinfo: dgram.RemoteInfo) {
        const text = msg.toString('utf8');
        if (!/^M-SEARCH \* HTTP\/1\.1/i.test(text)) return;
        const st = (/\r\nST:\s*(.+)\r\n/i.exec(text) || [])[1];
        if (typeof st === 'undefined') return;
        const search = st.trim();
        for (const t of this.targets()) {
            if (search === 'ssdp:all' || search === t.st) this.sendSearchResponse(t, rinfo);
        }
    }
    private sendSearchResponse(target: { st: string, usn: string }, rinfo: dgram.RemoteInfo) {
        const payload = [
            'HTTP/1.1 200 OK',
            `CACHE-CONTROL: max-age=${this.ttl}`,
            'EXT:',
            `LOCATION: ${this.location}`,
            'SERVER: nodejs-poolController UPnP/1.1',
            `ST: ${target.st}`,
            `USN: ${target.usn}`,
            '', ''
        ].join('\r\n');
        this.socket?.send(Buffer.from(payload), rinfo.port, rinfo.address, (err) => {
            if (err) this.emit('error', err);
        });
    }
    private sendAlive() {
        if (!this.socket) return;
        for (const t of this.targets()) this.sendNotify(t, 'ssdp:alive');
    }
    private sendNotify(target: { st: string, usn: string }, nts: string) {
        const lines = [
            'NOTIFY * HTTP/1.1',
            `HOST: ${SSDP_MULTICAST_ADDR}:${SSDP_PORT}`,
            `NT: ${target.st}`,
            `NTS: ${nts}`,
            `USN: ${target.usn}`,
            `SERVER: nodejs-poolController UPnP/1.1`
        ];
        if (nts === 'ssdp:alive') {
            lines.push(`CACHE-CONTROL: max-age=${this.ttl}`);
            lines.push(`LOCATION: ${this.location}`);
        }
        lines.push('', '');
        this.socket.send(Buffer.from(lines.join('\r\n')), SSDP_PORT, SSDP_MULTICAST_ADDR, (err) => {
            if (err) this.emit('error', err);
        });
    }
    public stop(): Promise<void> {
        return new Promise<void>((resolve) => {
            if (this.aliveTimer) { clearInterval(this.aliveTimer); this.aliveTimer = undefined; }
            if (!this.socket || !this.started) { this.started = false; return resolve(); }
            // Best-effort byebye so control points drop us promptly, then close.
            for (const t of this.targets()) this.sendNotify(t, 'ssdp:byebye');
            const socket = this.socket;
            this.socket = undefined;
            this.started = false;
            setImmediate(() => {
                try { socket.close(() => resolve()); }
                catch { resolve(); }
            });
        });
    }
}
