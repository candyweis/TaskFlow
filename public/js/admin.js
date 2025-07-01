class AdminPanel {
    constructor() {
        this.currentUser = null;
        this.token = localStorage.getItem('taskflow_admin_token');
        this.users = [];
        this.projects = [];
        this.overleafProjects = [];
        this.currentSection = 'stats';
        this.editingUserId = null;
        this.editingProjectId = null;
        this.editingOverleafProjectId = null;
        this.analyticsData = null;
        
        this.init();
    }

    async init() {
        this.bindEvents();
        await this.checkAuth();
    }

    bindEvents() {
        // Авторизация
        document.getElementById('authForm').addEventListener('submit', (e) => this.handleAuth(e));
        
        // Навигация
        document.querySelectorAll('.nav-btn').forEach(btn => {
            if (btn.dataset.section) {
                btn.addEventListener('click', () => this.switchSection(btn.dataset.section));
            }
        });
        
        // Кнопки
        document.getElementById('logoutBtn').addEventListener('click', () => this.logout());
        document.getElementById('addUserBtn').addEventListener('click', () => this.showAddUserModal());
        document.getElementById('addProjectBtn').addEventListener('click', () => this.showAddProjectModal());
        document.getElementById('addOverleafProjectBtn').addEventListener('click', () => this.showAddOverleafProjectModal());
        
        // Формы
        document.getElementById('userForm').addEventListener('submit', (e) => this.saveUser(e));
        document.getElementById('projectForm').addEventListener('submit', (e) => this.saveProject(e));
        document.getElementById('overleafProjectForm').addEventListener('submit', (e) => this.saveOverleafProject(e));
        
        // Аналитика
        const periodFilter = document.getElementById('periodFilter');
        const employeeFilter = document.getElementById('employeeFilter');
        const exportBtn = document.getElementById('exportBtn');
        
        if (periodFilter) periodFilter.addEventListener('change', () => this.loadAnalytics());
        if (employeeFilter) employeeFilter.addEventListener('change', () => this.loadAnalytics());
        if (exportBtn) exportBtn.addEventListener('click', () => this.exportData());
        
        // Закрытие модальных окон
        document.querySelectorAll('.close').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const modal = btn.closest('.modal');
                if (modal) {
                    this.closeModal(modal.id);
                }
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
    }

    async checkAuth() {
        if (this.token) {
            try {
                const response = await this.apiCall('/api/auth/verify');
                if (response.ok) {
                    const data = await response.json();
                    if (data.user.role === 'admin') {
                        this.currentUser = data.user;
                        this.showAdminPanel();
                    } else {
                        this.logout();
                        this.showNotification('Нет прав администратора', 'error');
                    }
                } else {
                    this.logout();
                }
            } catch (error) {
                this.logout();
            }
        } else {
            this.showAuth();
        }
    }

    showAuth() {
        document.getElementById('authModal').classList.add('show');
        document.getElementById('adminPanel').classList.add('d-none');
    }

    showAdminPanel() {
        document.getElementById('authModal').classList.remove('show');
        document.getElementById('adminPanel').classList.remove('d-none');
        
        document.getElementById('currentAdmin').textContent = this.currentUser.username;
        
        this.loadData();
    }

    async handleAuth(e) {
        e.preventDefault();
        
        const submitButton = document.getElementById('authButton');
        const buttonText = document.getElementById('authButtonText');
        const loader = document.getElementById('authLoader');
        
        submitButton.disabled = true;
        buttonText.style.display = 'none';
        loader.style.display = 'block';
        
        try {
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();
            
            if (response.ok) {
                if (data.user.role !== 'admin') {
                    this.showNotification('Нет прав администратора', 'error');
                    return;
                }
                
                this.token = data.token;
                this.currentUser = data.user;
                localStorage.setItem('taskflow_admin_token', this.token);
                this.showAdminPanel();
                this.showNotification('Добро пожаловать в админ панель!', 'success');
            } else {
                this.showNotification(data.error || 'Ошибка входа', 'error');
            }
        } catch (error) {
            this.showNotification('Ошибка соединения с сервером', 'error');
            console.error('Auth error:', error);
        } finally {
            submitButton.disabled = false;
            buttonText.style.display = 'block';
            loader.style.display = 'none';
        }
    }

    logout() {
        localStorage.removeItem('taskflow_admin_token');
        this.token = null;
        this.currentUser = null;
        this.showAuth();
        this.showNotification('Вы вышли из админ панели', 'info');
    }

    switchSection(section) {
        this.currentSection = section;
        
        // Обновляем активные кнопки
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.section === section);
        });
        
        // Показываем нужную секцию
        document.querySelectorAll('.content-section').forEach(sec => {
            sec.style.display = sec.id === section + 'Section' ? 'block' : 'none';
        });
        
        if (section === 'stats') {
            this.loadStats();
        } else if (section === 'analytics') {
            this.loadAnalytics();
        } else if (section === 'users') {
            this.loadUsers();
        } else if (section === 'projects') {
            this.loadProjects();
        } else if (section === 'overleaf') {
            this.loadOverleafProjects();
        }
    }

    async loadData() {
        await Promise.all([
            this.loadStats(),
            this.loadUsers(),
            this.loadProjects(),
            this.loadOverleafProjects()
        ]);
    }

    async loadStats() {
        try {
            const response = await this.apiCall('/api/admin/stats');
            if (response.ok) {
                const stats = await response.json();
                
                document.getElementById('totalUsers').textContent = stats.activeUsers || 0;
                document.getElementById('totalProjects').textContent = stats.totalProjects || 0;
                
                const tasksByStatus = stats.tasksByStatus || {};
                const totalTasks = Object.values(tasksByStatus).reduce((sum, count) => sum + count, 0);
                const completedTasks = tasksByStatus.done || 0;
                
                document.getElementById('totalTasks').textContent = totalTasks;
                document.getElementById('completedTasks').textContent = completedTasks;
            }
        } catch (error) {
            console.error('Error loading stats:', error);
        }
    }

    async loadAnalytics() {
        try {
            console.log('🔄 Loading analytics...');
            
            // Загружаем пользователей для фильтра если еще не загружены
            if (this.users.length === 0) {
                await this.loadUsersForFilter();
            } else {
                this.populateEmployeeFilter();
            }
            
            // Загружаем аналитику
            const period = document.getElementById('periodFilter')?.value || 'month';
            const employee_id = document.getElementById('employeeFilter')?.value || '';
            
            console.log('🔧 Analytics filters:', { period, employee_id });
            
            let url = `/api/analytics/dashboard?period=${period}`;
            if (employee_id) {
                url += `&employee_id=${employee_id}`;
            }
            
            const response = await this.apiCall(url);
            
            if (response.ok) {
                const data = await response.json();
                console.log('✅ Analytics data received:', data);
                this.analyticsData = data;
                this.renderAnalytics(data);
            } else {
                console.error('❌ Failed to load analytics, status:', response.status);
                this.showNotification('Ошибка загрузки аналитики', 'error');
            }
        } catch (error) {
            console.error('❌ Error loading analytics:', error);
            this.showNotification('Ошибка соединения с сервером', 'error');
        }
    }

    async loadUsersForFilter() {
        try {
            console.log('🔄 Loading users for filter...');
            const response = await this.apiCall('/api/admin/users');
            if (response.ok) {
                this.users = await response.json();
                console.log('✅ Users loaded for filter:', this.users.length);
                this.populateEmployeeFilter();
            }
        } catch (error) {
            console.error('❌ Error loading users for filter:', error);
        }
    }

    populateEmployeeFilter() {
        const employeeFilter = document.getElementById('employeeFilter');
        if (!employeeFilter) {
            console.log('❌ Employee filter element not found');
            return;
        }
        
        // Сохраняем текущее значение
        const currentValue = employeeFilter.value;
        
        employeeFilter.innerHTML = '<option value="">Все сотрудники</option>';
        
        // Фильтруем только работников и менеджеров
        const workers = this.users.filter(user => 
            (user.role === 'worker' || user.role === 'manager') && user.is_active
        );
        
        console.log('👥 Available workers for filter:', workers.length);
        
        workers.forEach(user => {
            const option = document.createElement('option');
            option.value = user.id;
            option.textContent = user.username;
            employeeFilter.appendChild(option);
        });
        
        // Восстанавливаем значение
        employeeFilter.value = currentValue;
        
        console.log('✅ Employee filter populated with', workers.length, 'users');
    }

    renderAnalytics(data) {
        console.log('🎨 Rendering analytics:', data);
        
        const stats = data.time_stats || [];
        const dashboard = data.dashboard || {};
        
        console.log('📊 Time stats:', stats);
        console.log('📊 Dashboard:', dashboard);
        
        // Обновляем статистику
        const totalHoursEl = document.getElementById('totalHours');
        const activeEmployeesEl = document.getElementById('activeEmployees');
        const completedWithTimeEl = document.getElementById('completedWithTime');
        const avgHoursPerTaskEl = document.getElementById('avgHoursPerTask');
        
        if (totalHoursEl) totalHoursEl.textContent = (dashboard.total_hours || 0).toFixed(1);
        if (activeEmployeesEl) activeEmployeesEl.textContent = stats.length;
        if (completedWithTimeEl) completedWithTimeEl.textContent = dashboard.tasks_with_time || 0;
        if (avgHoursPerTaskEl) avgHoursPerTaskEl.textContent = dashboard.avg_hours_per_log ? dashboard.avg_hours_per_log.toFixed(1) : '0';

        // Обновляем таблицу
        this.renderEmployeeTable(stats);
    }

    renderEmployeeTable(stats) {
        console.log('📋 Rendering employee table with', stats.length, 'entries');
        
        const tbody = document.getElementById('employeeStatsBody');
        if (!tbody) {
            console.log('❌ Employee stats table body not found');
            return;
        }
        
        tbody.innerHTML = '';

        if (stats.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" class="empty-cell">
                        <div class="empty-state">
                            <i class="fas fa-chart-line"></i>
                            <p>Нет данных за выбранный период</p>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        stats.forEach((stat, index) => {
            console.log('👤 Rendering employee:', stat);
            
            const row = document.createElement('tr');
            
            // Создаем аватар из первой буквы имени
            const avatar = stat.username ? stat.username.charAt(0).toUpperCase() : '?';
            
            // Определяем градиент для аватара на основе индекса
            const gradients = [
                'linear-gradient(135deg, #667eea, #764ba2)',
                'linear-gradient(135deg, #f093fb, #f5576c)',
                'linear-gradient(135deg, #4facfe, #00f2fe)',
                'linear-gradient(135deg, #43e97b, #38f9d7)',
                'linear-gradient(135deg, #fa709a, #fee140)',
                'linear-gradient(135deg, #a8edea, #fed6e3)',
                'linear-gradient(135deg, #ff9a9e, #fecfef)',
                'linear-gradient(135deg, #a1c4fd, #c2e9fb)'
            ];
            
            const gradientIndex = index % gradients.length;
            
            row.innerHTML = `
                <td>
                    <div class="user-info">
                        <div class="user-avatar" style="background: ${gradients[gradientIndex]}">
                            ${avatar}
                        </div>
                        <strong>${this.escapeHtml(stat.username || 'Неизвестно')}</strong>
                    </div>
                </td>
                <td>
                    <span class="stat-number tasks">
                        ${stat.tasks_completed || 0}
                    </span>
                </td>
                <td>
                    <span class="stat-number hours">
                        ${(stat.total_hours || 0).toFixed(1)} ч
                    </span>
                </td>
                <td>
                    <span class="stat-number avg">
                        ${(stat.avg_hours_per_task || 0).toFixed(1)} ч
                    </span>
                </td>
                <td>
                    <span class="stat-number logs">
                        ${stat.time_logs_count || 0}
                    </span>
                </td>
            `;
            
            tbody.appendChild(row);
        });
        
        console.log('✅ Employee table rendered successfully');
    }


    async exportData() {
        try {
            const period = document.getElementById('periodFilter')?.value || 'month';
            const employee_id = document.getElementById('employeeFilter')?.value || '';
            
            let url = `/api/analytics/export/time-logs?format=csv&period=${period}`;
            if (employee_id) {
                url += `&employee_id=${employee_id}`;
            }
            
            console.log('📤 Exporting data from URL:', url);
            
            const response = await this.apiCall(url);
            
            if (response.ok) {
                const blob = await response.blob();
                const downloadUrl = window.URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = downloadUrl;
                
                const employeeName = employee_id ? 
                    (this.users.find(u => u.id == employee_id)?.username || 'unknown') : 
                    'all';
                    
                link.download = `time-logs-${period}-${employeeName}-${new Date().toISOString().split('T')[0]}.csv`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                window.URL.revokeObjectURL(downloadUrl);
                
                this.showNotification('Файл успешно экспортирован', 'success');
            } else {
                this.showNotification('Ошибка экспорта данных', 'error');
            }
        } catch (error) {
            console.error('Error exporting data:', error);
            this.showNotification('Ошибка экспорта данных', 'error');
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
            this.showNotification('Ошибка загрузки пользователей', 'error');
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
            this.showNotification('Ошибка загрузки проектов', 'error');
        }
    }

    async loadOverleafProjects() {
        try {
            const response = await this.apiCall('/api/overleaf-projects');
            if (response.ok) {
                this.overleafProjects = await response.json();
                this.renderOverleafProjects();
            }
        } catch (error) {
            console.error('Error loading overleaf projects:', error);
            this.showNotification('Ошибка загрузки проектов Overleaf', 'error');
        }
    }

    renderUsers() {
        const tbody = document.getElementById('usersTableBody');
        tbody.innerHTML = '';
        
        if (this.users.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" class="empty-cell">
                        <div class="empty-state">
                            <i class="fas fa-users"></i>
                            <p>Пользователи не найдены</p>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }
        
        this.users.forEach(user => {
            const row = document.createElement('tr');
            
            const statusClass = user.is_active ? 'active' : 'inactive';
            const statusText = user.is_active ? 'Активен' : 'Заблокирован';
            const roleText = this.getRoleText(user.role);
            
            row.innerHTML = `
                <td>${user.id}</td>
                <td>
                    <div class="user-info">
                        <strong>${this.escapeHtml(user.username)}</strong>
                        ${user.telegram_chat_id ? '<i class="fab fa-telegram" title="Telegram подключен"></i>' : ''}
                    </div>
                </td>
                <td><span class="role-badge role-${user.role}">${roleText}</span></td>
                <td><span class="status-badge ${statusClass}">${statusText}</span></td>
                <td>${user.telegram ? this.escapeHtml(user.telegram) : '—'}</td>
                <td>${user.phone ? this.escapeHtml(user.phone) : '—'}</td>
                <td>${user.vk ? this.escapeHtml(user.vk) : '—'}</td>
                <td>
                    <div class="action-buttons">
                        <button class="btn btn-sm btn-secondary" onclick="admin.editUser(${user.id})" title="Редактировать">
                            <i class="fas fa-edit"></i>
                        </button>
                        ${user.id !== 1 ? `
                            <button class="btn btn-sm btn-danger" onclick="admin.deleteUser(${user.id})" title="Удалить">
                                <i class="fas fa-trash"></i>
                            </button>
                        ` : ''}
                    </div>
                </td>
            `;
            
            tbody.appendChild(row);
        });
    }

    renderProjects() {
        const tbody = document.getElementById('projectsTableBody');
        tbody.innerHTML = '';
        
        if (this.projects.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="empty-cell">
                        <div class="empty-state">
                            <i class="fas fa-project-diagram"></i>
                            <p>Проекты не найдены</p>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }
        
        this.projects.forEach(project => {
            const row = document.createElement('tr');
            
            const createdDate = new Date(project.created_at).toLocaleDateString('ru-RU');
            
            row.innerHTML = `
                <td>${project.id}</td>
                <td>
                    <strong>${this.escapeHtml(project.name)}</strong>
                </td>
                <td class="description-cell">
                    ${project.description ? this.escapeHtml(project.description) : '<em>Без описания</em>'}
                </td>
                <td>${this.escapeHtml(project.created_by_name || 'Неизвестен')}</td>
                <td>${createdDate}</td>
                <td>
                    <div class="action-buttons">
                        <button class="btn btn-sm btn-secondary" onclick="admin.editProject(${project.id})" title="Редактировать">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn btn-sm btn-danger" onclick="admin.deleteProject(${project.id})" title="Удалить">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            `;
            
            tbody.appendChild(row);
        });
    }

    renderOverleafProjects() {
        const tbody = document.getElementById('overleafTableBody');
        tbody.innerHTML = '';
        
        if (this.overleafProjects.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" class="empty-cell">
                        <div class="empty-state">
                            <i class="fas fa-external-link-alt"></i>
                            <p>Проекты Overleaf не найдены</p>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }
        
        this.overleafProjects.forEach(project => {
            const row = document.createElement('tr');
            
            const createdDate = new Date(project.created_at).toLocaleDateString('ru-RU');
            
            row.innerHTML = `
                <td>${project.id}</td>
                <td>
                    <strong>${this.escapeHtml(project.name)}</strong>
                </td>
                <td class="description-cell">
                    ${project.description ? this.escapeHtml(project.description) : '<em>Без описания</em>'}
                </td>
                <td class="center">
                    ${project.project_link ? `
                        <a href="${project.project_link}" target="_blank" class="btn btn-sm btn-info">
                            <i class="fas fa-external-link-alt"></i>
                        </a>
                    ` : '<em>Нет ссылки</em>'}
                </td>
                <td>${this.escapeHtml(project.created_by_name || 'Неизвестен')}</td>
                <td>${createdDate}</td>
                <td>
                    <div class="action-buttons">
                        <button class="btn btn-sm btn-secondary" onclick="admin.editOverleafProject(${project.id})" title="Редактировать">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn btn-sm btn-danger" onclick="admin.deleteOverleafProject(${project.id})" title="Удалить">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            `;
            
            tbody.appendChild(row);
        });
    }

    showAddUserModal() {
        this.editingUserId = null;
        document.getElementById('userModalTitle').textContent = 'Добавить пользователя';
        document.getElementById('passwordGroup').style.display = 'block';
        this.clearUserForm();
        this.showModal('userModal');
    }

    showAddProjectModal() {
        this.editingProjectId = null;
        document.getElementById('projectModalTitle').textContent = 'Добавить проект';
        this.clearProjectForm();
        this.showModal('projectModal');
    }

    showAddOverleafProjectModal() {
        this.editingOverleafProjectId = null;
        document.getElementById('overleafProjectModalTitle').textContent = 'Добавить проект Overleaf';
        this.clearOverleafProjectForm();
        this.showModal('overleafProjectModal');
    }

    editUser(userId) {
        const user = this.users.find(u => u.id === userId);
        if (!user) return;
        
        this.editingUserId = userId;
        document.getElementById('userModalTitle').textContent = 'Редактировать пользователя';
        document.getElementById('passwordGroup').style.display = 'none';
        
        // Заполняем форму
        document.getElementById('userUsername').value = user.username;
        document.getElementById('userRole').value = user.role;
        document.getElementById('userTelegram').value = user.telegram || '';
        document.getElementById('userPhone').value = user.phone || '';
        document.getElementById('userVk').value = user.vk || '';
        document.getElementById('userStatus').value = user.is_active ? '1' : '0';
        
        // Заполняем права
        const permissions = user.permissions || {};
        document.getElementById('canManageUsers').checked = permissions.canManageUsers || false;
        document.getElementById('canManageProjects').checked = permissions.canManageProjects || false;
        document.getElementById('canManageTasks').checked = permissions.canManageTasks || false;
        document.getElementById('canDevelop').checked = permissions.canDevelop || false;
        document.getElementById('canReview').checked = permissions.canReview || false;
        document.getElementById('canDeploy').checked = permissions.canDeploy || false;
        
        this.showModal('userModal');
    }

    editProject(projectId) {
        const project = this.projects.find(p => p.id === projectId);
        if (!project) return;
        
        this.editingProjectId = projectId;
        document.getElementById('projectModalTitle').textContent = 'Редактировать проект';
        
        document.getElementById('projectName').value = project.name;
        document.getElementById('projectDescription').value = project.description || '';
        
        this.showModal('projectModal');
    }

    editOverleafProject(projectId) {
        const project = this.overleafProjects.find(p => p.id === projectId);
        if (!project) return;
        
        this.editingOverleafProjectId = projectId;
        document.getElementById('overleafProjectModalTitle').textContent = 'Редактировать проект Overleaf';
        
        document.getElementById('overleafProjectName').value = project.name;
        document.getElementById('overleafProjectDescription').value = project.description || '';
        document.getElementById('overleafProjectLink').value = project.project_link || '';
        
        this.showModal('overleafProjectModal');
    }

    async saveUser(e) {
        e.preventDefault();
        
        const formData = {
            username: document.getElementById('userUsername').value.trim(),
            role: document.getElementById('userRole').value,
            telegram: document.getElementById('userTelegram').value.trim() || null,
            phone: document.getElementById('userPhone').value.trim() || null,
            vk: document.getElementById('userVk').value.trim() || null,
            is_active: document.getElementById('userStatus').value === '1',
            permissions: {
                canManageUsers: document.getElementById('canManageUsers').checked,
                canManageProjects: document.getElementById('canManageProjects').checked,
                canManageTasks: document.getElementById('canManageTasks').checked,
                canDevelop: document.getElementById('canDevelop').checked,
                canReview: document.getElementById('canReview').checked,
                canDeploy: document.getElementById('canDeploy').checked
            }
        };
        
        if (!this.editingUserId) {
            const password = document.getElementById('userPassword').value;
            if (!password) {
                this.showNotification('Пароль обязателен для нового пользователя', 'error');
                return;
            }
            formData.password = password;
        }
        
        if (!formData.username) {
            this.showNotification('Имя пользователя обязательно', 'error');
            return;
        }
        
        try {
            let response;
            
            if (this.editingUserId) {
                response = await this.apiCall(`/api/admin/users/${this.editingUserId}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(formData)
                });
            } else {
                response = await this.apiCall('/api/admin/users', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(formData)
                });
            }
            
            if (response.ok) {
                const data = await response.json();
                this.showNotification(data.message || 'Пользователь сохранен', 'success');
                this.closeModal('userModal');
                await this.loadUsers();
            } else {
                const error = await response.json();
                this.showNotification(error.error || 'Ошибка сохранения', 'error');
            }
        } catch (error) {
            console.error('Error saving user:', error);
            this.showNotification('Ошибка соединения с сервером', 'error');
        }
    }

    async saveProject(e) {
        e.preventDefault();
        
        const formData = {
            name: document.getElementById('projectName').value.trim(),
            description: document.getElementById('projectDescription').value.trim()
        };
        
        if (!formData.name) {
            this.showNotification('Название проекта обязательно', 'error');
            return;
        }
        
        try {
            let response;
            
            if (this.editingProjectId) {
                response = await this.apiCall(`/api/projects/${this.editingProjectId}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(formData)
                });
            } else {
                response = await this.apiCall('/api/projects', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(formData)
                });
            }
            
            if (response.ok) {
                const data = await response.json();
                this.showNotification(data.message || 'Проект сохранен', 'success');
                this.closeModal('projectModal');
                await this.loadProjects();
            } else {
                const error = await response.json();
                this.showNotification(error.error || 'Ошибка сохранения проекта', 'error');
            }
        } catch (error) {
            console.error('Error saving project:', error);
            this.showNotification('Ошибка соединения с сервером', 'error');
        }
    }

    async saveOverleafProject(e) {
        e.preventDefault();
        
        const formData = {
            name: document.getElementById('overleafProjectName').value.trim(),
            description: document.getElementById('overleafProjectDescription').value.trim(),
            project_link: document.getElementById('overleafProjectLink').value.trim()
        };
        
        if (!formData.name) {
            this.showNotification('Название проекта обязательно', 'error');
            return;
        }
        
        try {
            let response;
            
            if (this.editingOverleafProjectId) {
                response = await this.apiCall(`/api/overleaf-projects/${this.editingOverleafProjectId}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(formData)
                });
            } else {
                response = await this.apiCall('/api/overleaf-projects', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(formData)
                });
            }
            
            if (response.ok) {
                const data = await response.json();
                this.showNotification(data.message || 'Проект Overleaf сохранен', 'success');
                this.closeModal('overleafProjectModal');
                await this.loadOverleafProjects();
            } else {
                const error = await response.json();
                this.showNotification(error.error || 'Ошибка сохранения проекта Overleaf', 'error');
            }
        } catch (error) {
            console.error('Error saving overleaf project:', error);
            this.showNotification('Ошибка соединения с сервером', 'error');
        }
    }

    async deleteUser(userId) {
        if (userId === 1) {
            this.showNotification('Нельзя удалить главного администратора', 'error');
            return;
        }
        
        const user = this.users.find(u => u.id === userId);
        if (!user) return;
        
        if (!confirm(`Вы уверены, что хотите удалить пользователя "${user.username}"?`)) {
            return;
        }
        
        try {
            const response = await this.apiCall(`/api/admin/users/${userId}`, {
                method: 'DELETE'
            });
            
            if (response.ok) {
                const data = await response.json();
                this.showNotification(data.message || 'Пользователь удален', 'success');
                await this.loadUsers();
            } else {
                const error = await response.json();
                this.showNotification(error.error || 'Ошибка удаления', 'error');
            }
        } catch (error) {
            console.error('Error deleting user:', error);
            this.showNotification('Ошибка соединения с сервером', 'error');
        }
    }

    async deleteProject(projectId) {
        const project = this.projects.find(p => p.id === projectId);
        if (!project) return;
        
        if (!confirm(`Вы уверены, что хотите удалить проект "${project.name}"? Все связанные задачи также будут удалены.`)) {
            return;
        }
        
        try {
            const response = await this.apiCall(`/api/projects/${projectId}`, {
                method: 'DELETE'
            });
            
            if (response.ok) {
                const data = await response.json();
                this.showNotification(data.message || 'Проект удален', 'success');
                await this.loadProjects();
            } else {
                const error = await response.json();
                this.showNotification(error.error || 'Ошибка удаления проекта', 'error');
            }
        } catch (error) {
            console.error('Error deleting project:', error);
            this.showNotification('Ошибка соединения с сервером', 'error');
        }
    }

    async deleteOverleafProject(projectId) {
        const project = this.overleafProjects.find(p => p.id === projectId);
        if (!project) return;
        
        if (!confirm(`Вы уверены, что хотите удалить проект Overleaf "${project.name}"?`)) {
            return;
        }
        
        try {
            const response = await this.apiCall(`/api/overleaf-projects/${projectId}`, {
                method: 'DELETE'
            });
            
            if (response.ok) {
                const data = await response.json();
                this.showNotification(data.message || 'Проект Overleaf удален', 'success');
                await this.loadOverleafProjects();
            } else {
                const error = await response.json();
                this.showNotification(error.error || 'Ошибка удаления проекта Overleaf', 'error');
            }
        } catch (error) {
            console.error('Error deleting overleaf project:', error);
            this.showNotification('Ошибка соединения с сервером', 'error');
        }
    }

    clearUserForm() {
        document.getElementById('userForm').reset();
        document.querySelectorAll('#userForm input[type="checkbox"]').forEach(cb => cb.checked = false);
    }

    clearProjectForm() {
        document.getElementById('projectForm').reset();
    }

    clearOverleafProjectForm() {
        document.getElementById('overleafProjectForm').reset();
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
        document.getElementById(modalId).classList.add('show');
        
        setTimeout(() => {
            const modal = document.getElementById(modalId);
            const firstInput = modal.querySelector('input, select, textarea');
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
        }, 4000);
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
    if (window.admin) {
        window.admin.closeModal(modalId);
    }
};

// Инициализация админ панели
document.addEventListener('DOMContentLoaded', () => {
    window.admin = new AdminPanel();
});
