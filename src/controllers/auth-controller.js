import jwt from 'jsonwebtoken'; 
import { ConnectionModelService } from '../services/model-services/connection-model-service.js';
import { getSecret } from '../helpers/secret-store.js';
import logger from '../services/logger/index.js';
import axios from 'axios';
import querystring from 'querystring';



const TAG = "auth_controller"
const connectionModelService = new ConnectionModelService()


export const authorize = async (req, res) => {

    const { userId, backToUrl, accountId } = req.session;
    const { token } = req.query;
    logger.debug("authorize", TAG, {"accountId":accountId, "userId":userId})
    const connection = await connectionModelService.getConnectionByUserId(accountId);

    if (connection?.mondayToken) {
        logger.debug("connection?.mondayToken exists", TAG, {"mondayToken":connection?.mondayToken})
        return res.redirect(backToUrl);
    }

    const clientId = getSecret("MONDAY_CLIENT_ID");
    const redirectUri = getSecret("MONDAY_REDIRECT_URI");
    console.log("clientId",clientId)
    // const scopes = [
    //     'boards:read',
    //     'boards:write',
    //     'notifications:write'
    // ].join(' ');

    // const url = `https://auth.monday.com/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${token}&scope=${encodeURIComponent(scopes)}`;
    // const url = new URL('https://auth.monday.com/oauth2/authorize');

    // url.searchParams.set('client_id', clientId);
    // url.searchParams.set('redirect_uri', redirectUri);
    // url.searchParams.set('state', token);
    // url.searchParams.set('scope', scopes);
    // console.log("url",url.toString())
    
    return res.redirect('https://auth.monday.com/oauth2/authorize?' +
    querystring.stringify({
      client_id: clientId,
      redirect_uri: redirectUri,
      state: token,
      scopes: "boards:read boards:write notifications:write"
    }));
};


export const mondayCallback = async (req, res) => {
    logger.debug("started mondayCallback", TAG, {"req.query":req.query})
    const { code, state: mondayToken } = req.query;

    const { accountId, backToUrl } = jwt.verify(mondayToken, getSecret("MONDAY_SIGNING_SECRET"));
    const clientId = getSecret("MONDAY_CLIENT_ID");
    const clientSecret = getSecret("MONDAY_CLIENT_SECRET");
    const redirectUri = getSecret("MONDAY_REDIRECT_URI");
    
    try {
        const tokenResponse = await axios.post('https://auth.monday.com/oauth2/token', {
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri
        });

        const accessToken = tokenResponse.data.access_token;

        // שומר את הטוקן במסד נתונים או storage שלך
        await connectionModelService.upsertConnection(accountId, {
        mondayToken: accessToken
        });

        logger.info("Successfully connected monday", TAG, { accountId });
        return res.redirect(backToUrl);

    } catch (err) {
        logger.error("Failed to exchange code for token", TAG, {
        error: err.response?.data || err.message,
        accountId
        });
        return res.status(500).send("OAuth token exchange failed");
    }
}
