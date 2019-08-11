import {Express} from "express";

const Events = require('events');
const crypto = require('crypto');
const got = require('got');
const qs = require('querystring');

class ExpressPubSub extends Events {
  private secret: string;
  private callbackUrl: string;
  private leaseSeconds: number;
  constructor(options: { secret: string; callbackUrl: string; leaseSeconds: number; }) {
    super();

    this.secret = options.secret;
    this.callbackUrl = options.callbackUrl;
    this.leaseSeconds = options.leaseSeconds;
  }

  bind(app: Express) {
    app.get('/', (req, res) => {
      const {'hub.topic': topic, 'hub.mode': mode} = req.query;
      if (!topic || !mode) {
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
          res.sendStatus(403);
          break;
        }
      }
    });

    app.post('/', (req, res) => {
      let {topic, hub} = req.query;

      const requestRels = /<([^>]+)>;\s*rel=(?:["'](?=.*["']))?([A-z]+)/gi.exec(req.get('link'));
      if(requestRels) {
        const [, url, rel] = requestRels;
        setTopicHub(url, rel);
      }

      if (!topic) {
        return res.sendStatus(400);
      }

      if (this.secret) {
        if (!req.get('x-hub-signature')) {
          return res.sendStatus(403);
        }

        const signatureParts = req.get('x-hub-signature').split('=');
        const algo = (signatureParts.shift() || '').toLowerCase();
        const signature = (signatureParts.pop() || '').toLowerCase();
        let hmac;

        try {
          hmac = crypto.createHmac(algo, crypto.createHmac('sha1', this.secret).update(topic).digest('hex'));
        } catch (err) {
          return res.sendStatus(403);
        }

        hmac.update(req.body);

        if (hmac.digest('hex').toLowerCase() !== signature) {
          return res.sendStatus(202);
        }
      }

      res.sendStatus(204);

      this.emit('feed', {
        topic,
        hub,
        callback: 'http://' + req.get('host') + req.url,
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

    app.use((req, res) => {
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

    const body: {[s: string]: any} = {
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

    return got.post(hub, {
      body: qs.stringify(body)
    }).then((res: any) => {
      if (![202, 204].includes(res.statusCode)) {
        const err = new Error(`Invalid response status ${res.statusCode}`);
        // @ts-ignore
        err.response = res;
        throw err;
      }
      return res;
    });
  }
}

export default ExpressPubSub;