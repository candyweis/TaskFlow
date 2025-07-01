const TelegramBot = require('node-telegram-bot-api');
const User = require('./models/User');
const Task = require('./models/Task');
const Project = require('./models/Project');

class TaskFlowTelegramBot {
    constructor() {
        // Токен можно задать напрямую или через переменную окружения
        this.token = process.env.TELEGRAM_BOT_TOKEN || '7238087192:AAF_v9R4jS_O2dZ8tRqG6wjNbEk75GUSrkA';
        
        // Проверяем токен
        if (!this.token || this.token === 'YOUR_BOT_TOKEN_HERE') {
            throw new Error('Telegram bot token not configured');
        }
        
        this.bot = null;
        this.isRunning = false;
        this.initBot();
    }

    async initBot() {
        try {
            console.log('🤖 Initializing Telegram bot...');
            
            // Создаем бота без polling
            this.bot = new TelegramBot(this.token, { polling: false });
            
            // Удаляем webhook если он был установлен
            await this.bot.deleteWebHook();
            console.log('✅ Webhook deleted');
            
            // Небольшая пауза
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Запускаем polling
            await this.bot.startPolling({
                restart: true,
                polling: {
                    interval: 300,
                    autoStart: true,
                    params: {
                        timeout: 10
                    }
                }
            });
            
            this.isRunning = true;
            console.log('✅ Telegram bot polling started');
            
            this.setupCommands();
            this.setupErrorHandling();
            
        } catch (error) {
            console.error('❌ Failed to initialize Telegram bot:', error);
            throw error;
        }
    }

    setupErrorHandling() {
        // Обработка ошибок polling
        this.bot.on('polling_error', (error) => {
            console.error('Telegram polling error:', error.message);
            
            // Если это конфликт, пытаемся перезапустить
            if (error.code === 'ETELEGRAM' && error.message.includes('409')) {
                console.log('🔄 Attempting to restart bot due to conflict...');
                this.restart();
            }
        });

        // Обработка webhook ошибок
        this.bot.on('webhook_error', (error) => {
            console.error('Telegram webhook error:', error);
        });

        // Graceful shutdown
        process.on('SIGINT', () => {
            console.log('📛 Received SIGINT. Shutting down Telegram bot gracefully...');
            this.stop();
            process.exit(0);
        });

        process.on('SIGTERM', () => {
            console.log('📛 Received SIGTERM. Shutting down Telegram bot gracefully...');
            this.stop();
            process.exit(0);
        });
    }

    async restart() {
        try {
            console.log('🔄 Restarting Telegram bot...');
            await this.stop();
            await new Promise(resolve => setTimeout(resolve, 2000));
            await this.initBot();
        } catch (error) {
            console.error('❌ Failed to restart bot:', error);
        }
    }

    async stop() {
        if (this.bot && this.isRunning) {
            try {
                console.log('⏹️ Stopping Telegram bot...');
                await this.bot.stopPolling();
                this.isRunning = false;
                console.log('✅ Telegram bot stopped');
            } catch (error) {
                console.error('Error stopping bot:', error);
            }
        }
    }

    setupCommands() {
        if (!this.bot) return;

        // Команда /start
        this.bot.onText(/\/start/, async (msg) => {
            const chatId = msg.chat.id;
            const welcomeMessage = `
🤖 *Добро пожаловать в TaskFlow Bot!*

Этот бот поможет вам получать уведомления о задачах.

*Доступные команды:*
/link <username> - Связать аккаунт TaskFlow с Telegram
/unlink - Отвязать аккаунт
/status - Проверить статус связывания
/help - Показать эту справку

*Пример:*
\`/link admin\` - связать аккаунт admin с этим Telegram

После связывания вы будете получать уведомления о:
• Назначении на новые задачи
• Изменении статуса ваших задач
• Комментариях к вашим задачам
• Уведомления по ролям
            `;
            
            try {
                await this.bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
            } catch (error) {
                console.error('Error sending start message:', error);
            }
        });

        // Команда /link
        this.bot.onText(/\/link (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            const username = match[1].trim();

            try {
                const user = await User.findByUsername(username);
                if (!user) {
                    await this.bot.sendMessage(chatId, '❌ Пользователь не найден. Проверьте правильность написания username.');
                    return;
                }

                // Обновляем chat_id пользователя
                await User.updateTelegramChatId(user.id, chatId);
                
                await this.bot.sendMessage(chatId, `✅ Аккаунт *${username}* успешно привязан к Telegram!\n\nТеперь вы будете получать уведомления о задачах.`, { parse_mode: 'Markdown' });
                
                console.log(`User ${username} linked Telegram chat ID: ${chatId}`);
            } catch (error) {
                console.error('Error linking user:', error);
                await this.bot.sendMessage(chatId, '❌ Произошла ошибка при привязке аккаунта. Попробуйте позже.');
            }
        });

        // Команда /unlink
        this.bot.onText(/\/unlink/, async (msg) => {
            const chatId = msg.chat.id;

            try {
                const user = await User.findByTelegramChatId(chatId);
                if (!user) {
                    await this.bot.sendMessage(chatId, '❌ Ваш аккаунт не найден.');
                    return;
                }

                await User.updateTelegramChatId(user.id, null);
                await this.bot.sendMessage(chatId, '✅ Аккаунт успешно отвязан от Telegram.');
                
                console.log(`User ${user.username} unlinked from Telegram`);
            } catch (error) {
                console.error('Error unlinking user:', error);
                await this.bot.sendMessage(chatId, '❌ Произошла ошибка при отвязке аккаунта.');
            }
        });

        // Команда /status
        this.bot.onText(/\/status/, async (msg) => {
            const chatId = msg.chat.id;

            try {
                const user = await User.findByTelegramChatId(chatId);
                if (!user) {
                    await this.bot.sendMessage(chatId, '❌ Ваш аккаунт не привязан к TaskFlow.\n\nИспользуйте /link <username> для привязки.');
                    return;
                }

                const statusMessage = `
✅ *Статус связывания*

👤 Пользователь: *${user.username}*
🏷️ Роль: *${this.getRoleText(user.role)}*
📱 Chat ID: \`${chatId}\`
📅 Дата регистрации: ${new Date(user.created_at).toLocaleDateString('ru-RU')}

Уведомления: *Включены* ✅
                `;

                await this.bot.sendMessage(chatId, statusMessage, { parse_mode: 'Markdown' });
            } catch (error) {
                console.error('Error checking status:', error);
                await this.bot.sendMessage(chatId, '❌ Произошла ошибка при проверке статуса.');
            }
        });

        // Команда /help
        this.bot.onText(/\/help/, async (msg) => {
            const chatId = msg.chat.id;
            const helpMessage = `
🆘 *Справка по командам*

/start - Начать работу с ботом
/link <username> - Привязать аккаунт TaskFlow
/unlink - Отвязать аккаунт
/status - Проверить статус привязки
/help - Показать эту справку

*Типы уведомлений:*
📋 Назначение на задачу
🔄 Изменение статуса задачи
💬 Новые комментарии
⏰ Приближение дедлайна
👷 Уведомления по ролям

*Поддержка:* Обратитесь к администратору системы
            `;
            
            try {
                await this.bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
            } catch (error) {
                console.error('Error sending help message:', error);
            }
        });

        console.log('🤖 Telegram bot commands setup completed');
    }

    getRoleText(role) {
        const roles = {
            admin: 'Администратор',
            manager: 'Менеджер',
            worker: 'Исполнитель'
        };
        return roles[role] || role;
    }

    getStatusEmoji(status) {
        const statusEmojis = {
            unassigned: '📥',
            in_progress: '🔄',
            developed: '💻',
            review: '👀',
            deploy: '📤',
            done: '✅',
            archived: '📦'
        };
        return statusEmojis[status] || '📋';
    }

    getStatusText(status) {
        const statusTexts = {
            unassigned: 'Неразобранные',
            in_progress: 'В работе',
            developed: 'Техарь',
            review: 'На проверке',
            deploy: 'Загружать',
            done: 'Готово',
            archived: 'Архивировано'
        };
        return statusTexts[status] || status;
    }

    getPriorityEmoji(priority) {
        const priorityEmojis = {
            low: '🟢',
            medium: '🟡',
            high: '🔴'
        };
        return priorityEmojis[priority] || '⚪';
    }

    // Безопасная отправка сообщения
    async safeSendMessage(chatId, message, options = {}) {
        if (!this.bot || !this.isRunning) {
            console.warn('Bot is not running, skipping message');
            return false;
        }

        try {
            await this.bot.sendMessage(chatId, message, options);
            return true;
        } catch (error) {
            console.error(`Error sending message to ${chatId}:`, error.message);
            return false;
        }
    }

    // Уведомление о назначении на задачу
    async notifyTaskAssignment(taskId, assigneeIds, assignedBy) {
        if (!this.isRunning) return;

        try {
            const task = await Task.findById(taskId);
            if (!task) return;

            const project = await Project.findById(task.project_id);
            const assigner = await User.findById(assignedBy);

            for (const assigneeId of assigneeIds) {
                const user = await User.findById(assigneeId);
                if (!user || !user.telegram_chat_id) continue;

                const message = `
📋 *Вас назначили на новую задачу!*

*Задача:* ${task.title}
${task.goal ? `*Цель:* ${task.goal}` : ''}
*Проект:* ${project ? project.name : 'Без проекта'}
*Приоритет:* ${this.getPriorityEmoji(task.priority)} ${task.priority}
*Дедлайн:* ${new Date(task.deadline).toLocaleString('ru-RU')}
*Назначил:* ${assigner ? assigner.username : 'Неизвестно'}

*Описание:*
${task.description || 'Описание отсутствует'}

🔗 [Открыть в TaskFlow](${process.env.APP_URL || 'http://localhost:3000'})
                `;

                const sent = await this.safeSendMessage(user.telegram_chat_id, message, { parse_mode: 'Markdown' });
                if (sent) {
                    console.log(`Sent assignment notification to ${user.username}`);
                }
            }
        } catch (error) {
            console.error('Error sending assignment notification:', error);
        }
    }

    // Уведомление о назначении по роли
    async notifyRoleAssignment(taskId, role, assignedBy) {
        if (!this.isRunning) return;

        try {
            const task = await Task.findById(taskId);
            if (!task) return;

            const project = await Project.findById(task.project_id);
            const assigner = await User.findById(assignedBy);

            let users = [];
            let roleText = '';

            switch (role) {
                case 'tech':
                    users = await User.findTechUsers();
                    roleText = 'Техарь';
                    break;
                case 'review':
                    users = await User.findReviewUsers();
                    roleText = 'Проверка';
                    break;
                case 'deploy':
                    users = await User.findDeployUsers();
                    roleText = 'Загружать';
                    break;
            }

            for (const user of users) {
                if (!user.telegram_chat_id) continue;

                const message = `
👷 *Новая задача для роли "${roleText}"*

*Задача:* ${task.title}
${task.goal ? `*Цель:* ${task.goal}` : ''}
*Проект:* ${project ? project.name : 'Без проекта'}
*Приоритет:* ${this.getPriorityEmoji(task.priority)} ${task.priority}
*Дедлайн:* ${new Date(task.deadline).toLocaleString('ru-RU')}
*Назначил:* ${assigner ? assigner.username : 'Неизвестно'}

*Описание:*
${task.description || 'Описание отсутствует'}

Эта задача назначена на вашу роль. Следующее уведомление придет когда задача перейдет в соответствующую колонку.

🔗 [Открыть в TaskFlow](${process.env.APP_URL || 'http://localhost:3000'})
                `;

                const sent = await this.safeSendMessage(user.telegram_chat_id, message, { parse_mode: 'Markdown' });
                if (sent) {
                    console.log(`Sent role assignment notification to ${user.username} for role ${roleText}`);
                }
            }
        } catch (error) {
            console.error('Error sending role assignment notification:', error);
        }
    }

    // Уведомление об изменении статуса задачи
    async notifyTaskStatusChange(taskId, oldStatus, newStatus, changedBy) {
        if (!this.isRunning) return;

        try {
            const task = await Task.findById(taskId);
            if (!task) return;

            const project = await Project.findById(task.project_id);
            const changer = await User.findById(changedBy);
            const creator = await User.findById(task.created_by);

            // Уведомляем создателя задачи
            if (creator && creator.telegram_chat_id && creator.id !== changedBy) {
                const message = `
🔄 *Изменен статус задачи*

*Задача:* ${task.title}
*Проект:* ${project ? project.name : 'Без проекта'}

*Статус изменен:*
${this.getStatusEmoji(oldStatus)} ${this.getStatusText(oldStatus)} → ${this.getStatusEmoji(newStatus)} ${this.getStatusText(newStatus)}

*Изменил:* ${changer ? changer.username : 'Неизвестно'}
*Время:* ${new Date().toLocaleString('ru-RU')}

🔗 [Открыть в TaskFlow](${process.env.APP_URL || 'http://localhost:3000'})
                `;

                const sent = await this.safeSendMessage(creator.telegram_chat_id, message, { parse_mode: 'Markdown' });
                if (sent) {
                    console.log(`Sent status change notification to creator ${creator.username}`);
                }
            }

            // Уведомляем назначенных пользователей (кроме того, кто изменил)
            if (task.assignees && task.assignees.length > 0) {
                for (const assigneeId of task.assignees) {
                    if (assigneeId === changedBy) continue;

                    const user = await User.findById(assigneeId);
                    if (!user || !user.telegram_chat_id) continue;

                    const message = `
🔄 *Статус вашей задачи изменен*

*Задача:* ${task.title}
*Проект:* ${project ? project.name : 'Без проекта'}

*Новый статус:* ${this.getStatusEmoji(newStatus)} ${this.getStatusText(newStatus)}
*Изменил:* ${changer ? changer.username : 'Неизвестно'}

🔗 [Открыть в TaskFlow](${process.env.APP_URL || 'http://localhost:3000'})
                    `;

                    const sent = await this.safeSendMessage(user.telegram_chat_id, message, { parse_mode: 'Markdown' });
                    if (sent) {
                        console.log(`Sent status change notification to assignee ${user.username}`);
                    }
                }
            }

            // Уведомляем пользователей по ролям при переходе в соответствующую колонку
            await this.notifyRoleStatusChange(task, newStatus, changer);

        } catch (error) {
            console.error('Error sending status change notification:', error);
        }
    }

    // Уведомления по ролям при изменении статуса
    async notifyRoleStatusChange(task, newStatus, changer) {
        try {
            let users = [];
            let roleText = '';

            switch (newStatus) {
                case 'developed':
                    users = await User.findTechUsers();
                    roleText = 'Техарь';
                    break;
                case 'review':
                    users = await User.findReviewUsers();
                    roleText = 'Проверка';
                    break;
                case 'deploy':
                    users = await User.findDeployUsers();
                    roleText = 'Загружать';
                    break;
                default:
                    return; // Не уведомляем для других статусов
            }

            const project = await Project.findById(task.project_id);

            for (const user of users) {
                if (!user.telegram_chat_id) continue;
                if (task.assignees && task.assignees.includes(user.id)) continue; // Уже получил уведомление как участник

                const message = `
🎯 *Задача готова для вашей роли "${roleText}"*

*Задача:* ${task.title}
${task.goal ? `*Цель:* ${task.goal}` : ''}
*Проект:* ${project ? project.name : 'Без проекта'}
*Приоритет:* ${this.getPriorityEmoji(task.priority)} ${task.priority}
*Дедлайн:* ${new Date(task.deadline).toLocaleString('ru-RU')}
*Переместил:* ${changer ? changer.username : 'Неизвестно'}

*Описание:*
${task.description || 'Описание отсутствует'}

🔗 [Открыть в TaskFlow](${process.env.APP_URL || 'http://localhost:3000'})
                `;

                const sent = await this.safeSendMessage(user.telegram_chat_id, message, { parse_mode: 'Markdown' });
                if (sent) {
                    console.log(`Sent role status notification to ${user.username} for role ${roleText}`);
                }
            }
        } catch (error) {
            console.error('Error sending role status notification:', error);
        }
    }

    // Уведомление о новом комментарии
    async notifyNewComment(taskId, commentText, commentBy) {
        if (!this.isRunning) return;

        try {
            const task = await Task.findById(taskId);
            if (!task) return;

            const project = await Project.findById(task.project_id);
            const commenter = await User.findById(commentBy);

            const usersToNotify = new Set();
            
            // Добавляем создателя задачи
            if (task.created_by && task.created_by !== commentBy) {
                usersToNotify.add(task.created_by);
            }
            
            // Добавляем назначенных пользователей
            if (task.assignees) {
                task.assignees.forEach(assigneeId => {
                    if (assigneeId !== commentBy) {
                        usersToNotify.add(assigneeId);
                    }
                });
            }

            for (const userId of usersToNotify) {
                const user = await User.findById(userId);
                if (!user || !user.telegram_chat_id) continue;

                const message = `
💬 *Новый комментарий к задаче*

*Задача:* ${task.title}
*Проект:* ${project ? project.name : 'Без проекта'}
*Автор:* ${commenter ? commenter.username : 'Неизвестно'}

*Комментарий:*
"${commentText}"

🔗 [Открыть в TaskFlow](${process.env.APP_URL || 'http://localhost:3000'})
                `;

                const sent = await this.safeSendMessage(user.telegram_chat_id, message, { parse_mode: 'Markdown' });
                if (sent) {
                    console.log(`Sent comment notification to ${user.username}`);
                }
            }
        } catch (error) {
            console.error('Error sending comment notification:', error);
        }
    }

    // Уведомление об изменении логина
    async notifyUsernameChange(userId, oldUsername, newUsername) {
        if (!this.isRunning) return;

        try {
            const user = await User.findById(userId);
            if (!user || !user.telegram_chat_id) return;

            const message = `
🔄 *Ваш логин изменен*

*Старый логин:* ${oldUsername}
*Новый логин:* ${newUsername}

Теперь используйте новый логин для входа в систему TaskFlow.

🔗 [Открыть TaskFlow](${process.env.APP_URL || 'http://localhost:3000'})
            `;

            const sent = await this.safeSendMessage(user.telegram_chat_id, message, { parse_mode: 'Markdown' });
            if (sent) {
                console.log(`Sent username change notification to ${user.username}`);
            }
        } catch (error) {
            console.error('Error sending username change notification:', error);
        }
    }

    // Метод для отправки произвольных уведомлений
    async sendCustomNotification(userId, message) {
        if (!this.isRunning) return false;

        try {
            const user = await User.findById(userId);
            if (!user || !user.telegram_chat_id) return false;

            const sent = await this.safeSendMessage(user.telegram_chat_id, message, { parse_mode: 'Markdown' });
            if (sent) {
                console.log(`Sent custom notification to ${user.username}`);
            }
            return sent;
        } catch (error) {
            console.error('Error sending custom notification:', error);
            return false;
        }
    }
}

module.exports = TaskFlowTelegramBot;
