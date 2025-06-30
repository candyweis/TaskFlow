class AdminPanel {
    constructor() {
        this.currentUser = null;
        this.token = localStorage.getItem('taskflow_token');
        this.users = [];
        this.projects = [];
        this.stats = {};
        this.currentSection = 'dashboard';
        this.editingUserId = null;
        
        this.init();
    }

    async init() {
        this.bindEvents();
        await this.checkAuth();
    }

    bindEvents() {
        // Авторизация админа
        document.getElementById('adminAuthForm').addEventListener('submit', (e) => this.handleAuth(e));
        
        // Навигация
        document.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                this.switchSection(link.dataset.section);
            });
        });
        
        // Кнопки
        document.getElementById('adminLogout').addEventListener('click', () => this.logout());
        document.getElementById('addUserBtn').addEventListener('click', () => this.showAddUserModal());
        
        // Формы
        document.getElementById('userForm').addEventListener('submit', (e) => this.saveUser(e));
        
        // Закрытие модальных окон
        document.querySelectorAll('.close').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const modal = e.target.closest('.modal');
                this.closeModal(modal.id);
            });
        });

        // Клик вне модального окна
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.closeModal(modal.id);
                }
            });
        });

        // Изменение роли пользователя
        document.getElementById('userRole').addEventListener('change', (e) => {
            this.updatePermissionsByRole(e.target.value);
        });
    }

    async checkAuth() {
        if (this.token) {
            try {
                const response = await this.apiCall('/api/admin/stats');
                if (response.ok) {
                    await this.loadUserProfile();
                    this.showAdminPanel();
                } else {
                    this.showAuth();
                }
            } catch (error) {
                this.showAuth();
            }
        } else {
            this.showAuth();
        }
    }

    async loadUserProfile() {
        try {
            const tokenData = JSON.parse(atob(this.token.split('.')[1]));
            this.currentUser = {
                id: tokenData.id,
                username: tokenData.username,
                role: tokenData.role,
                permissions: JSON.parse(tokenData.permissions || '{}')
            };
        } catch (error) {
            console.error('Error loading user profile:', error);
            this.showAuth();
        }
    }

    showAuth() {
        document.getElementById('adminAuthModal').classList.add('show');
        document.getElementById('adminPanel').style.display = 'none';
    }

    showAdminPanel() {
        document.getElementById('adminAuthModal').classList.remove('show');
        document.getElementById('adminPanel').style.display = 'flex';
        
        document.getElementById('adminCurrentUser').textContent = this.currentUser.username;
        
        this.loadData();
    }

    async handleAuth(e) {
        e.preventDefault();
        
        const username = document.getElementById('adminUsername').value;
        const password = document.getElementById('adminPassword').value;
        
        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();
            
            if (response.ok && (data.user.role === 'admin')) {
                this.token = data.token;
                this.currentUser = data.user;
                localStorage.setItem('taskflow_token', this.token);
                this.showAdminPanel();
                this.showNotification('Добро пожаловать в админ-панель!', 'success');
            } else {
                this.showNotification('Недостаточно прав для доступа к админ-панели', 'error');
            }
        } catch (error) {
            this.showNotification('Ошибка соединения с сервером', 'error');
        }
    }

    logout() {
        localStorage.removeItem('taskflow_token');
        this.token = null;
        this.currentUser = null;
        this.showAuth();
        this.showNotification('Вы вышли из админ-панели', 'info');
    }

    switchSection(section) {
        this.currentSection = section;
        
        // Обновляем активные ссылки
        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.toggle('active', link.dataset.section === section);
        });
        
        // Показываем нужную секцию
        document.querySelectorAll('.admin-section').forEach(sec => {
            sec.style.display = sec.id === section + 'Section' ? 'block' : 'none';
        });
        
        // Обновляем заголовок
        const titles = {
            dashboard: 'Дашборд',
            users: 'Управление пользователями',
            projects: 'Управление проектами',
            settings: 'Настройки'
        };
        document.getElementById('sectionTitle').textContent = titles[section] || section;
        
        // Загружаем данные для секции
        if (section === 'dashboard') {
            this.loadStats();
        } else if (section === 'users') {
            this.loadUsers();
        } else if (section === 'projects') {
            this.loadProjects();
        }
    }

    async loadData() {
        await Promise.all([
            this.loadStats(),
            this.loadUsers(),
            this.loadProjects()
        ]);
    }

    async loadStats() {
        try {
            const response = await this.apiCall('/api/admin/stats');
            if (response.ok) {
                this.stats = await response.json();
                this.renderStats();
            }
        } catch (error) {
            console.error('Error loading stats:', error);
        }
    }

    async loadUsers() {
        try {
            const response = await this.apiCall('/api/admin/users');
            if (response.ok) {
                this.users = await response.json();
                this.renderUsers();
            }
        } catch (error) {
            console.error('Error loading users:', error);
        }
    }

    async loadProjects() {
        try {
            const response = await this.apiCall('/api/projects');
            if (response.ok) {
                this.projects = await response.json();
                this.renderProjects();
            }
        } catch (error) {
            console.error('Error loading projects:', error);
        }
    }

    renderStats() {
        document.getElementById('totalUsers').textContent = this.stats.activeUsers || 0;
        document.getElementById('totalProjects').textContent = this.stats.totalProjects || 0;
        
        const tasksByStatus = this.stats.tasksByStatus || {};
        const totalTasks = Object.values(tasksByStatus).reduce((a, b) => a + b, 0);
        const completedTasks = tasksByStatus.done || 0;
        
        document.getElementById('totalTasks').textContent = totalTasks;
        document.getElementById('completedTasks').textContent = completedTasks;
    }

    renderUsers() {
        const tbody = document.getElementById('usersTableBody');
        tbody.innerHTML = '';
        
        this.users.forEach(user => {
            const permissions = user.permissions || {};
            const permissionsList = [];
            
            if (permissions.canManageUsers) permissionsList.push('Управление пользователями');
            if (permissions.canManageProjects) permissionsList.push('Управление проектами');
            if (permissions.canManageTasks) permissionsList.push('Управление задачами');
            if (permissions.canDevelop) permissionsList.push('Разработка');
            if (permissions.canReview) permissionsList.push('Проверка');
            if (permissions.canDeploy) permissionsList.push('Деплой');
            
            // Формируем контакты
            const contacts = [];
            if (user.phone) contacts.push(`<i class="fas fa-phone"></i> ${user.phone}`);
            if (user.telegram) contacts.push(`<i class="fab fa-telegram"></i> ${user.telegram}`);
            
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${user.id}</td>
                <td>${this.escapeHtml(user.username)}</td>
                <td><span class="role-badge role-${user.role}">${this.getRoleText(user.role)}</span></td>
                <td>
                    <div class="contacts-list">
                        ${contacts.length > 0 ? contacts.join('<br>') : '<em>Не указаны</em>'}
                    </div>
                </td>
                <td>
                    <div class="permissions-list">
                        ${permissionsList.map(p => `<span>${p}</span>`).join('')}
                    </div>
                </td>
                <td><span class="status-badge status-${user.is_active ? 'active' : 'inactive'}">${user.is_active ? 'Активен' : 'Неактивен'}</span></td>
                <td>
                    <button class="btn btn-sm btn-secondary" onclick="adminPanel.editUser(${user.id})">
                        <i class="fas fa-edit"></i>
                    </button>
                    ${user.id !== 1 ? `
                        <button class="btn btn-sm btn-danger" onclick="adminPanel.deleteUser(${user.id})" style="margin-left: 5px;">
                            <i class="fas fa-trash"></i>
                        </button>
                    ` : ''}
                </td>
            `;
            tbody.appendChild(row);
        });
    }

    renderProjects() {
        const container = document.getElementById('adminProjectsList');
        container.innerHTML = '';
        
        if (this.projects.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-project-diagram"></i>
                    <h3>Пока нет проектов</h3>
                    <p>Проекты будут отображаться здесь после их создания</p>
                </div>
            `;
            return;
        }
        
        this.projects.forEach(project => {
            const card = document.createElement('div');
            card.className = 'admin-project-card';
            card.innerHTML = `
                <h3>${this.escapeHtml(project.name)}</h3>
                <p>${this.escapeHtml(project.description || 'Без описания')}</p>
                <div class="project-stats">
                    <small>Задач: ${project.total_tasks || 0} | Выполнено: ${project.completed_tasks || 0}</small>
                </div>
                <div class="project-actions">
                    <button class="btn btn-sm btn-secondary">
                        <i class="fas fa-edit"></i> Редактировать
                    </button>
                </div>
            `;
            container.appendChild(card);
        });
    }

    showAddUserModal() {
        this.editingUserId = null;
        document.getElementById('userModalTitle').textContent = 'Добавить пользователя';
        document.getElementById('passwordGroup').style.display = 'block';
        document.getElementById('userForm').reset();
        this.showModal('userModal');
    }

    editUser(userId) {
        const user = this.users.find(u => u.id === userId);
        if (!user) return;
        
        this.editingUserId = userId;
        document.getElementById('userModalTitle').textContent = 'Редактировать пользователя';
        document.getElementById('passwordGroup').style.display = 'none';
        
        // Заполняем форму данными пользователя
        document.getElementById('userUsername').value = user.username;
        document.getElementById('userRole').value = user.role;
        document.getElementById('userPhone').value = user.phone || '';
        document.getElementById('userTelegram').value = user.telegram || '';
        
        // Устанавливаем права доступа
        const permissions = user.permissions || {};
        document.getElementById('canManageUsers').checked = permissions.canManageUsers || false;
        document.getElementById('canManageProjects').checked = permissions.canManageProjects || false;
        document.getElementById('canManageTasks').checked = permissions.canManageTasks || false;
        document.getElementById('canDevelop').checked = permissions.canDevelop || false;
        document.getElementById('canReview').checked = permissions.canReview || false;
        document.getElementById('canDeploy').checked = permissions.canDeploy || false;
        
        this.showModal('userModal');
    }

    async deleteUser(userId) {
        if (!confirm('Вы уверены, что хотите удалить этого пользователя?')) {
            return;
        }
        
        try {
            const response = await this.apiCall(`/api/admin/users/${userId}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                await this.loadUsers();
                this.showNotification('Пользователь удален', 'success');
            } else {
                const error = await response.json();
                this.showNotification(error.error || 'Ошибка удаления пользователя', 'error');
            }
        } catch (error) {
            this.showNotification('Ошибка соединения с сервером', 'error');
        }
    }

    async saveUser(e) {
        e.preventDefault();
        
        const username = document.getElementById('userUsername').value;
        const password = document.getElementById('userPassword').value;
        const role = document.getElementById('userRole').value;
        const phone = document.getElementById('userPhone').value;
        const telegram = document.getElementById('userTelegram').value;
        
        const permissions = {
            canManageUsers: document.getElementById('canManageUsers').checked,
            canManageProjects: document.getElementById('canManageProjects').checked,
            canManageTasks: document.getElementById('canManageTasks').checked,
            canDevelop: document.getElementById('canDevelop').checked,
            canReview: document.getElementById('canReview').checked,
            canDeploy: document.getElementById('canDeploy').checked
        };
        
        try {
            let response;
            if (this.editingUserId) {
                // Обновление пользователя
                response = await this.apiCall(`/api/admin/users/${this.editingUserId}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ 
                        role, 
                        permissions, 
                        is_active: 1,
                        phone,
                        telegram
                    })
                });
            } else {
                // Создание пользователя
                response = await this.apiCall('/api/admin/users', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ 
                        username, 
                        password, 
                        role, 
                        permissions,
                        phone,
                        telegram
                    })
                });
            }

            if (response.ok) {
                await this.loadUsers();
                this.closeModal('userModal');
                this.showNotification(
                    this.editingUserId ? 'Пользователь обновлен' : 'Пользователь создан', 
                    'success'
                );
            } else {
                const error = await response.json();
                this.showNotification(error.error || 'Ошибка сохранения пользователя', 'error');
            }
        } catch (error) {
            this.showNotification('Ошибка соединения с сервером', 'error');
        }
    }

    updatePermissionsByRole(role) {
        const permissions = {
            admin: {
                canManageUsers: true,
                canManageProjects: true,
                canManageTasks: true,
                canDevelop: true,
                canReview: true,
                canDeploy: true
            },
            manager: {
                canManageUsers: false,
                canManageProjects: true,
                canManageTasks: true,
                canDevelop: true,
                canReview: true,
                canDeploy: true
            },
            worker: {
                canManageUsers: false,
                canManageProjects: false,
                canManageTasks: false,
                canDevelop: true,
                canReview: false,
                canDeploy: false
            }
        };
        
        const rolePermissions = permissions[role] || permissions.worker;
        
        Object.keys(rolePermissions).forEach(permission => {
            const checkbox = document.getElementById(permission);
            if (checkbox) {
                checkbox.checked = rolePermissions[permission];
            }
        });
    }

    getRoleText(role) {
        const roles = {
            admin: 'Администратор',
            manager: 'Менеджер',
            worker: 'Исполнитель'
        };
        return roles[role] || role;
    }

    showModal(modalId) {
        const modal = document.getElementById(modalId);
        modal.classList.add('show');
        
        setTimeout(() => {
            const firstInput = modal.querySelector('input:not([type="checkbox"]), select, textarea');
            if (firstInput) firstInput.focus();
        }, 100);
    }

    closeModal(modalId) {
        document.getElementById(modalId).classList.remove('show');
    }

    showNotification(message, type = 'success') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        
        const icons = {
            success: 'fas fa-check-circle',
            error: 'fas fa-exclamation-triangle',
            warning: 'fas fa-exclamation-circle',
            info: 'fas fa-info-circle'
        };
        
        notification.innerHTML = `
            <i class="${icons[type]}"></i>
            ${this.escapeHtml(message)}
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => notification.classList.add('show'), 100);
        
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    async apiCall(url, options = {}) {
        const defaultOptions = {
            headers: {
                'Authorization': `Bearer ${this.token}`,
                ...options.headers
            }
        };
        
        return fetch(url, { ...options, ...defaultOptions });
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Глобальные функции для использования в HTML
window.closeModal = function(modalId) {
    if (window.adminPanel) {
        window.adminPanel.closeModal(modalId);
    }
};

// Инициализация админ-панели
document.addEventListener('DOMContentLoaded', () => {
    window.adminPanel = new AdminPanel();
});
