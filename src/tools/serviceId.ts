import {ServiceInterface} from "../checker";

const serviceId = {
  wrap(service: ServiceInterface, id: string | number): string {
    return [service.id.substr(0, 2), JSON.stringify(id)].join(':');
  },
  unwrap(sid: string): string | number {
    return JSON.parse(sid.substr(3));
  }
};

export default serviceId;