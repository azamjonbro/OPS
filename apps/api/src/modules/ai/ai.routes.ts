import { Router } from 'express';

import { validated } from '../../core/middleware/validate.js';
import { chatSchema } from '../conversations/conversation.validators.js';
import * as aiController from './ai.controller.js';

export const aiRouter: Router = Router();

aiRouter.post('/chat', ...validated({ body: chatSchema }, aiController.chat));
aiRouter.get('/status', aiController.status);
