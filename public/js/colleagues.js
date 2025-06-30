class ColleaguesApp {
    constructor() {
        this.currentUser = null;
        this.token = localStorage.getItem('taskflow_token');
        this.colleagues = [];
        this.projects = [];
        this.filteredColleagues = [];
        
        this.init();
    }

    async init() {
        this.bindEvents();
        await this.checkAuth();
    }

    bindEvents() {
        // Авторизация
        document.getElementById('authForm').addEventListener('submit', (e) => this.handleAuth(e));
        
        // Поиск и фильтрация
        document.getElementById('searchColleagues').addEventListener('input', (e) => this.filterColleagues());
        document.getElementById('roleFilter').addEventListener('change', (e) => this.filterColleagues());
        
        // Кнопки
        document.getElementById('logoutBtn').addEventListener('click', () => this.logout());
        document.getElementById('exportProjectsBtn').addEventListener('click', () => this.exportProjects());
    }

    async checkAuth() {
        if (this.token) {
            try {
                const response = await this.apiCall('/api/auth/verify');
                if (response.ok) {
                    const data = await response.json();
                    this.currentUser = data.user;
                    this.showApp();
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
            
            await this.login(username, password);
        } finally {
            submitButton.disabled = false;
            buttonText.style.display = 'block';
            loader.style.display = 'none';
        }
    }

    async login(username, password) {
        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();
            
            if (response.ok) {
                this.token = data.token;
                this.currentUser = data.user;
                localStorage.setItem('taskflow_token', this.token);
                this.showApp();
                this.showNotification('Добро пожаловать!', 'success');
            } else {
                this.showNotification(data.error || 'Ошибка входа', 'error');
            }
        } catch (error) {
            this.showNotification('Ошибка соединения с сервером', 'error');
        }
    }

    showAuth() {
        document.getElementById('authModal').classList.add('show');
        document.getElementById('app').classList.add('d-none');
    }

    showApp() {
        document.getElementById('authModal').classList.remove('show');
        document.getElementById('app').classList.remove('d-none');
        
        document.getElementById('currentUser').textContent = this.currentUser.username;
        
        const roleElement = document.getElementById('currentRole');
        roleElement.textContent = this.getRoleText(this.currentUser.role);
        roleElement.className = `role-badge role-${this.currentUser.role}`;
        
        // Показываем админку только админам
        if (this.currentUser.role === 'admin') {
            document.getElementById('adminLink').style.display = 'flex';
        }
        
        this.loadData();
    }

    getRoleText(role) {
        const roles = {
            admin: 'Администратор',
            manager: 'Менеджер',
            worker: 'Исполнитель'
        };
        return roles[role] || role;
    }

    async loadData() {
        await Promise.all([
            this.loadColleagues(),
            this.loadProjects()
        ]);
        
        this.renderColleagues();
        this.renderProjectsTable();
    }

    async loadColleagues() {
        try {
            const response = await this.apiCall('/api/users/colleagues');
            if (response.ok) {
                this.colleagues = await response.json();
                this.filteredColleagues = [...this.colleagues];
            }
        } catch (error) {
            console.error('Error loading colleagues:', error);
        }
    }

    async loadProjects() {
        try {
            const response = await this.apiCall('/api/projects');
            if (response.ok) {
                this.projects = await response.json();
            }
        } catch (error) {
            console.error('Error loading projects:', error);
        }
    }

    filterColleagues() {
        const searchTerm = document.getElementById('searchColleagues').value.toLowerCase();
        const roleFilter = document.getElementById('roleFilter').value;
        
        this.filteredColleagues = this.colleagues.filter(colleague => {
            const matchesSearch = colleague.username.toLowerCase().includes(searchTerm) ||
                                this.getRoleText(colleague.role).toLowerCase().includes(searchTerm);
            const matchesRole = !roleFilter || colleague.role === roleFilter;
            
            return matchesSearch && matchesRole;
        });
        
        this.renderColleagues();
    }

    renderColleagues() {
        const container = document.getElementById('colleaguesList');
        container.innerHTML = '';
        
        if (this.filteredColleagues.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-users"></i>
                    <h3>Коллеги не найдены</h3>
                    <p>Попробуйте изменить параметры поиска</p>
                </div>
            `;
            return;
        }
        
        this.filteredColleagues.forEach(colleague => {
            const card = document.createElement('div');
            card.className = 'colleague-card';
            
            const permissions = colleague.permissions || {};
            const skills = [];
            if (permissions.canDevelop) skills.push('Разработка');
            if (permissions.canReview) skills.push('Проверка');
            if (permissions.canDeploy) skills.push('Деплой');
            if (permissions.canManageProjects) skills.push('Управление проектами');
            if (permissions.canManageTasks) skills.push('Управление задачами');
            if (permissions.canManageUsers) skills.push('Управление пользователями');
            
            card.innerHTML = `
                <div class="colleague-header">
                    <div class="colleague-avatar">
                        ${colleague.username.charAt(0).toUpperCase()}
                    </div>
                    <div class="colleague-info">
                        <h3>${this.escapeHtml(colleague.username)}</h3>
                        <span class="role-badge role-${colleague.role}">${this.getRoleText(colleague.role)}</span>
                    </div>
                </div>
                <div class="colleague-contacts">
                    ${colleague.telegram ? `
                        <div class="contact-item">
                            <i class="fab fa-telegram"></i>
                            <a href="https://t.me/${colleague.telegram.replace('@', '')}" target="_blank">
                                ${colleague.telegram}
                            </a>
                        </div>
                    ` : ''}
                    ${colleague.phone ? `
                        <div class="contact-item">
                            <i class="fas fa-phone"></i>
                            <a href="tel:${colleague.phone}">${colleague.phone}</a>
                        </div>
                    ` : ''}
                    ${!colleague.telegram && !colleague.phone ? `
                        <div class="contact-item no-contacts">
                            <i class="fas fa-exclamation-circle"></i>
                            <span>Контакты не указаны</span>
                        </div>
                    ` : ''}
                </div>
                <div class="colleague-skills">
                    <h4>Навыки и права:</h4>
                    <div class="skills-list">
                        ${skills.length > 0 ? skills.map(skill => `<span class="skill-tag">${skill}</span>`).join('') : '<span class="no-skills">Базовые права</span>'}
                    </div>
                </div>
            `;
            
            container.appendChild(card);
        });
    }

    renderProjectsTable() {
        const tbody = document.getElementById('projectsTableBody');
        tbody.innerHTML = '';
        
        if (this.projects.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" class="empty-cell">
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
            
            const progressPercent = project.total_tasks > 0 
                ? Math.round((project.completed_tasks / project.total_tasks) * 100) 
                : 0;
            
            row.innerHTML = `
                <td>
                    <strong>${this.escapeHtml(project.name)}</strong>
                </td>
                <td class="description-cell">
                    ${project.description ? this.escapeHtml(project.description) : '<em>Без описания</em>'}
                </td>
                <td>${this.escapeHtml(project.created_by_name || 'Неизвестен')}</td>
                <td class="center">${project.total_tasks}</td>
                <td class="center">${project.completed_tasks}</td>
                <td class="center">
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${progressPercent}%"></div>
                        <span class="progress-text">${progressPercent}%</span>
                    </div>
                </td>
                <td class="center">
                    <button class="btn btn-sm btn-secondary" onclick="colleaguesApp.copyProjectLink(${project.id})">
                        <i class="fas fa-link"></i>
                    </button>
                </td>
            `;
            
            tbody.appendChild(row);
        });
    }

    copyProjectLink(projectId) {
        const link = `${window.location.origin}/?project=${projectId}`;
        navigator.clipboard.writeText(link).then(() => {
            this.showNotification('Ссылка скопирована в буфер обмена', 'success');
        }).catch(() => {
            // Fallback для старых браузеров
            const textArea = document.createElement('textarea');
            textArea.value = link;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            this.showNotification('Ссылка скопирована в буфер обмена', 'success');
        });
    }

    exportProjects() {
        let csvContent = 'Проект,Описание,Создатель,Задач,Выполнено,Прогресс,Ссылка\n';
        
        this.projects.forEach(project => {
            const progressPercent = project.total_tasks > 0 
                ? Math.round((project.completed_tasks / project.total_tasks) * 100) 
                : 0;
                
            const link = `${window.location.origin}/?project=${project.id}`;
            
            csvContent += `"${project.name}","${project.description || ''}","${project.created_by_name || ''}",${project.total_tasks},${project.completed_tasks},${progressPercent}%,"${link}"\n`;
        });
        
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', 'projects_summary.csv');
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        this.showNotification('Экспорт завершен', 'success');
    }

    logout() {
        localStorage.removeItem('taskflow_token');
        this.token = null;
        this.currentUser = null;
        this.showAuth();
        this.showNotification('Вы вышли из системы', 'info');
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

// Инициализация приложения
document.addEventListener('DOMContentLoaded', () => {
    window.colleaguesApp = new ColleaguesApp();
});
