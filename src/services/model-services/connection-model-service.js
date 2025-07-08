import ConnectionStorage from '../../storage/connection-storage.js';
import logger from '../logger/index.js';

const TAG = 'connection_model_service';

/** @typedef {Object} Connection
 * @property {string} userId - The monday user ID
 * @property {string} mondayToken - The monday token of the user
 * @property {object} googleCalendarToken - The Google Calendar token of the user
 * @property {string} googleCalendarToken.access_token - The access token for Google Calendar
 * @property {string} googleCalendarToken.refresh_token - The refresh token for Google Calendar
 * @property {string} googleCalendarToken.scope - The scope of the Google Calendar token
 * @property {string} googleCalendarToken.token_type - The type of the token
 * @property {number} googleCalendarToken.expiry_date - The expiry date of the token
 */

/**
 * A service for interacting with Connection objects.
 * A Connection defines a relation between a monday user and their Google Calendar & monday.com credentials.
 *
 * @returns {ConnectionModelService} - An instance of the ConnectionModelService
 * @example
 * const connectionModelService = new ConnectionModelService();
 * const connection = await connectionModelService.getConnectionByUserId(userId);
 *
 * @example
 * const connectionModelService = new ConnectionModelService();
 * const connection = await connectionModelService.upsertConnection(userId, attributes);
 */
export class ConnectionModelService {
  constructor() {
    this.secureStorage = new ConnectionStorage();
  }

  /**
   * Retrieve a Google Calendar & monday.com connection based on a monday user ID.
   * @param {string} userId - The monday user ID
   * @returns {Promise<Connection>} - The fetched connection
   */
  async getConnectionByUserId(userId) {
    
    try {
      const response = await this.secureStorage.get(userId);
      return response;
    } catch (err) {
      logger.error('Failed to retrieve connection by user ID', TAG, { userId, error: err.message });
      throw err;
    }
  }

  /**
   * Create a Connection record in the DB.
   * A connection defines a relation between a monday user and their Google Calendar credentials.
   * @param {string} userId - The monday user ID
   * @param {Object} attributes - The attributes of the connection
   * @param {string=} attributes.mondayToken - The monday token of the user
   * @param {object=} attributes.googleCalendarToken - The Google Calendar token of the user
   * @returns {Promise<Connection>} - The created connection
   */
  async upsertConnection(userId, attributes) {
    logger.debug('Started upsertConnection', TAG, { userId, attributes });  

    try {
        
      const { mondayToken, tokens:googleCalendarToken } = attributes;
      const connection = await this.getConnectionByUserId(userId);
      const newConnection = {
        ...connection,
        ...mondayToken && { mondayToken },
        ...googleCalendarToken && { googleCalendarToken },
        userId
      };
    
      const response = await this.secureStorage.set(userId, newConnection);

      if (!response) {
        throw new Error('Failed to create connection');
      }

      return { userId, mondayToken, googleCalendarToken };
    } catch (err) {
      logger.error('Failed to create connection', TAG, { userId, error: err.message });
      throw err;
    }
  }

  /**
   * Delete a Connection record in the DB.
   * @param {string} userId - The monday user ID
   * @returns {Promise<void>}
   */
  async deleteConnection(userId) {
    try {
      const response = await this.secureStorage.delete(userId);

      if (!response) {
        throw new Error('Failed to delete connection');
      }
    } catch (err) {
      logger.error('Failed to delete connection', TAG, { userId, error: err.message });
      throw err;
    }
  }
}
