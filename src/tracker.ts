import {appConfig} from './appConfig';
import Tracker from './shared/tracker';
import fetchRequest from './shared/tools/fetchRequest';

const tracker = new Tracker(appConfig.gaId, fetchRequest);

export {tracker};
export default Tracker;
