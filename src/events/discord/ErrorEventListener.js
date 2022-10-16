import EventListener from '../EventListener.js';
import logger from '../../Logger.js';

export default class ErrorEventListener extends EventListener {
    get name() {
        return 'error';
    }

    /**
     * @param {Error} error
     * @return {Promise<void>}
     */
    async execute(error) {
        await logger.error('The discord client experienced an error', error);
    }
}