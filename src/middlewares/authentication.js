import jwt from 'jsonwebtoken';
import { getSecret } from '../helpers/secret-store.js';

const TAG = 'authentication-middleware';

export async function authenticationMiddleware(req, res, next) {
  try {
    // console.log('authenticationMiddleware called', "process.env.MONDAY_SIGNING_SECRET", process.env.MONDAY_SIGNING_SECRET, "getSecret(MONDAY_SIGNING_SECRET)", getSecret("MONDAY_SIGNING_SECRET"));
    let { authorization } = req.headers;
    if (!authorization && req.query) {
      authorization = req.query.token;
    }

    const { accountId, userId, backToUrl, shortLivedToken } = jwt.verify(
      authorization,
      getSecret("MONDAY_SIGNING_SECRET") || process.env.MONDAY_SIGNING_SECRET
    );

    req.session = { accountId, userId, backToUrl, shortLivedToken };
    next();
  } catch (err) {
    console.error("authenticationMiddleware", TAG, {"error":err});
    res.status(500).json({ error: 'not authenticated' });
  }
}
