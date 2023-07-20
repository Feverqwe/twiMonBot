import {ServiceInterface} from '../checker';

const serviceId = {
  wrap(service: ServiceInterface, id: string | number) {
    return [service.id.substring(0, 2), JSON.stringify(id)].join(':');
  },
  unwrap(sid: string): string | number {
    return JSON.parse(sid.substring(3));
  },
};

export default serviceId;
