import express from 'express';
import bodyParser from 'body-parser';
import routes from './routes/index.js';
import logger from './services/logger/index.js';
import dotenv from 'dotenv';
dotenv.config();

const TAG = 'server_runner';

const { PORT: port } = process.env;
const app = express();
console.log('process.env.PORT', process.env.PORT);
app.use(bodyParser.json());
app.use(routes);
app.listen(port, () => {
  logger.info(`up and running listening on port:${port}`, TAG, {"da":"ads"});
});

export default app;