const serviceId = {};
serviceId.wrap = (service, id) => {
  return [service.id.substr(0, 2), JSON.stringify(id)].join(':');
};
serviceId.unwrap = (sid) => {
  return JSON.parse(sid.substr(3));
};

export default serviceId;