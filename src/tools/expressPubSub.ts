import express, {Express} from "express";
import fetchRequest from "./fetchRequest";
import {EventEmitter} from "events";
import crypto from "crypto";
import qs from "querystring";
import RateLimit2 from "./rateLimit2";

const rateLimit = new RateLimit2(5);

const debug = require('debug')('app:ExpressPubSub');
const fetchRequestLimited = rateLimit.wrap(fetchRequest);

class ExpressPubSub extends EventEmitter {
  private readonly path: string;
  private readonly secret: string;
  private readonly callbackUrl: string;
  private readonly leaseSeconds: number;
  constructor(options: { path: string; secret: string; callbackUrl: string; leaseSeconds: number; }) {
    super();

    this.path = options.path;
    this.secret = options.secret;
    this.callbackUrl = options.callbackUrl;
    this.leaseSeconds = options.leaseSeconds;
  }

  bind(app: Express) {
    app.use(this.path, express.raw({
      type: 'application/atom+xml'
    }));

    const route = app.route(this.path);

    route.get((req, res) => {
      const {'hub.topic': topic, 'hub.mode': mode} = req.query;
      if (!topic || !mode) {
        if (!topic) {
          debug('get skip, cause: topic is empty');
        } else {
          debug('get skip, cause: mode is empty');
        }
        return res.sendStatus(400);
      }

      switch (mode) {
        case 'denied': {
          const {hub, 'hub.challenge': challenge} = req.query;
          const data = {
            topic,
            hub
          };
          res.send(challenge || 'ok');

          this.emit(mode, data);
          break;
        }
        case 'subscribe':
        case 'unsubscribe': {
          const {hub, 'hub.challenge': challenge, 'hub.lease_seconds': leaseSeconds} = req.query;
          const data = {
            lease: Number(leaseSeconds|| 0) + Math.trunc(Date.now() / 1000),
            topic,
            hub
          };
          res.send(challenge);

          this.emit(mode, data);
          break;
        }
        default: {
          debug('get skip, cause: unknown mode', mode);
          res.sendStatus(403);
          break;
        }
      }
    });

    route.post((req, res) => {
      let {topic, hub} = req.query;

      const requestRels = /<([^>]+)>;\s*rel=(?:["'](?=.*["']))?([A-z]+)/gi.exec(req.get('link')!);
      if(requestRels) {
        const [, url, rel] = requestRels;
        setTopicHub(url, rel);
      }

      if (!topic || typeof topic !== "string") {
        debug('post skip, cause: topic is empty');
        return res.sendStatus(400);
      }

      if (this.secret) {
        if (!req.get('x-hub-signature')) {
          debug('post skip, cause: x-hub-signature is empty');
          return res.sendStatus(403);
        }

        const signatureHeader = req.get('x-hub-signature') || '';
        const signatureParts = signatureHeader.split('=');
        const algo = (signatureParts.shift() || '').toLowerCase();
        const signature = (signatureParts.pop() || '').toLowerCase();
        let hmac;

        try {
          hmac = crypto.createHmac(algo, crypto.createHmac('sha1', this.secret).update(topic).digest('hex'));
        } catch (err) {
          debug('post skip, cause: %o', err);
          return res.sendStatus(403);
        }

        hmac.update(req.body);

        if (hmac.digest('hex').toLowerCase() !== signature) {
          debug('post skip, cause: signature is not equal');
          return res.sendStatus(202);
        }
      }

      res.sendStatus(204);

      this.emit('feed', {
        topic,
        hub,
        callback: req.protocol + '://' + req.hostname + req.originalUrl,
        feed: req.body,
        headers: req.headers
      });

      function setTopicHub(url: string, rel: string) {
        rel = rel || '';

        switch (rel.toLowerCase()) {
          case 'self':
            topic = url;
            break;
          case 'hub':
            hub = url;
            break;
        }
      }
    });

    route.all((req, res) => {
      res.sendStatus(405);
    });
  }

  subscribe(topic: string, hub: string, callbackUrl?: string): Promise<string> {
    return this.setSubscription('subscribe', topic, hub, callbackUrl);
  }

  unsubscribe(topic: string, hub: string, callbackUrl?: string): Promise<string> {
    return this.setSubscription('unsubscribe', topic, hub, callbackUrl);
  }

  setSubscription(mode: string, topic: string, hub: string, callbackUrl?: string): Promise<string> {
    if (!callbackUrl) {
      callbackUrl = this.callbackUrl +
        (/\//.test(this.callbackUrl.replace(/^https?:\/\//i, '')) ? '' : '/') +
        (/\?/.test(this.callbackUrl) ? '&' : '?') +
        'topic=' + encodeURIComponent(topic) +
        '&hub=' + encodeURIComponent(hub);
    }

    const body: {[s: string]: string | number} = {
      'hub.callback': callbackUrl,
      'hub.mode': mode,
      'hub.topic': topic,
      'hub.verify': 'async'
    };

    if (this.leaseSeconds > 0) {
      body['hub.lease_seconds'] = this.leaseSeconds;
    }

    if (this.secret) {
      body['hub.secret'] = crypto
        .createHmac('sha1', this.secret)
        .update(topic)
        .digest('hex');
    }

    return fetchRequestLimited(hub, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: qs.stringify(body),
      keepAlive: true,
    }).then((res) => {
      if (![202, 204].includes(res.statusCode)) {
        const err = new Error(`Invalid response status ${res.statusCode}`);
        Object.assign(err, {
          response: res,
        });
        throw err;
      }
      return res.body;
    });
  }
}

export default ExpressPubSub;