document.addEventListener('DOMContentLoaded', function() {
    // Global state for chart instances and current table data
    const charts = {};
    let currentTableData = [];

    // Mobile menu functionality
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const mobileMenuOverlay = document.getElementById('mobile-menu-overlay');
    const sidebar = document.querySelector('aside');

    if (mobileMenuBtn && mobileMenuOverlay && sidebar) {
        mobileMenuBtn.addEventListener('click', function() {
            sidebar.classList.toggle('mobile-open');
            mobileMenuOverlay.classList.toggle('active');
        });

        mobileMenuOverlay.addEventListener('click', function() {
            sidebar.classList.remove('mobile-open');
            mobileMenuOverlay.classList.remove('active');
        });
    }

    // Notification system
    function showNotification(message, type = 'info', duration = 3000) {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.innerHTML = `
            <div class="flex items-center justify-between">
                <div class="flex items-center">
                    <i class="fas ${getNotificationIcon(type)} mr-2"></i>
                    <span>${message}</span>
                </div>
                <button class="ml-4 text-gray-400 hover:text-gray-600" onclick="this.parentElement.parentElement.remove()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;
        document.body.appendChild(notification);
        
        setTimeout(() => notification.classList.add('show'), 100);
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, duration);
    }

    function getNotificationIcon(type) {
        switch(type) {
            case 'success': return 'fa-check-circle';
            case 'error': return 'fa-exclamation-circle';
            case 'warning': return 'fa-exclamation-triangle';
            default: return 'fa-info-circle';
        }
    }

    // Enhanced button loading states
    function setButtonLoading(button, loading) {
        if (loading) {
            button.classList.add('btn-loading');
            button.disabled = true;
        } else {
            button.classList.remove('btn-loading');
            button.disabled = false;
        }
    }

    // Refresh KPI button functionality
    const refreshKpiBtn = document.getElementById('refresh-kpi-btn');
    if (refreshKpiBtn) {
        refreshKpiBtn.addEventListener('click', function() {
            setButtonLoading(this, true);
            fetchDataAndRender().finally(() => {
                setButtonLoading(this, false);
                showNotification('Metrics refreshed successfully', 'success');
            });
        });
    }

    // Chart resize observer to handle dynamic sizing
    function initializeChartResizeObserver() {
        if (typeof ResizeObserver !== 'undefined') {
            const chartContainers = document.querySelectorAll('.chart-container');
            const resizeObserver = new ResizeObserver(entries => {
                entries.forEach(entry => {
                    const canvas = entry.target.querySelector('canvas');
                    if (canvas && charts[canvas.id]) {
                        // Small delay to ensure container has resized
                        setTimeout(() => {
                            charts[canvas.id].resize();
                        }, 100);
                    }
                });
            });

            chartContainers.forEach(container => {
                resizeObserver.observe(container);
            });
        }
    }

    // Initialize chart sizing after DOM is ready
    function ensureChartSizing() {
        // Wait for layout to stabilize
        setTimeout(() => {
            Object.keys(charts).forEach(chartId => {
                if (charts[chartId]) {
                    charts[chartId].resize();
                }
            });
        }, 500);
    }

    // --- Main Application Logic ---

    /**
     * Fetches all dashboard data from the backend and orchestrates the UI update.
     */
    async function fetchDataAndRender() {
        showLoading(true);
        hideError();

        const params = new URLSearchParams();
        document.querySelectorAll('.filter-select').forEach(sel => {
            if (sel.value && sel.value !== 'all') {
                params.append(sel.name, sel.value);
            }
        });

        try {
            const response = await fetch(`/api/data?${params.toString()}`);
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || 'An unknown error occurred on the server.');
            }
            
            currentTableData = data.table_data || [];

            if (!document.getElementById('location-filter').dataset.populated) {
                populateFilterOptions(data.filters);
            }

            updateKPIs(data.kpis);
            updateAllCharts(data.charts);
            populateTable(data.table_data, data.all_columns, data.default_columns);
            populateStatusModal(data.table_data);
            
            // Repopulate column selector every time to reflect schema changes
            populateColumnSelector(data.all_columns, data.default_columns);
            
            // Ensure proper chart sizing after data load
            ensureChartSizing();
            
            // Initialize resize observer if not already done
            if (!window.chartResizeObserverInitialized) {
                initializeChartResizeObserver();
                window.chartResizeObserverInitialized = true;
            }

        } catch (error) {
            console.error('Dashboard Render Error:', error);
            showError(`Failed to load dashboard data. ${error.message}`);
            showNotification(`Error loading dashboard: ${error.message}`, 'error');
        } finally {
            showLoading(false);
        }
    }

    // --- UI Update Functions (KPIs, Charts, etc. - largely unchanged) ---

    function updateKPIs(kpis = {}) {
        const kpiGrid = document.getElementById('kpi-grid');
        if (!kpiGrid) return;
        kpiGrid.innerHTML = '';
        const kpiMapping = {
            applications: 'No. of Applications', shortlisted: 'No. of Shortlisted',
            interviewed: 'No. of Interviewed', offered: 'No. of Offered',
            hired: 'No. of Hired', rejected: 'No. of Rejected',
            acceptance_rate: 'Acceptance Rate (%)', rejection_rate: 'Rejection Rate (%)'
        };
        for (const key in kpiMapping) {
            const card = document.createElement('div');
            card.className = 'bg-white p-4 rounded-lg shadow text-center';
            const value = kpis[key] !== undefined ? kpis[key] : '0';
            card.innerHTML = `<h4 class="text-sm font-medium text-gray-500">${kpiMapping[key]}</h4><p class="text-3xl font-bold text-gray-800">${value}</p>`;
            kpiGrid.appendChild(card);
        }
    }
    
    function populateTable(tableData = [], allColumns = [], defaultColumns = []) {
        const tableHead = document.querySelector('#data-table thead');
        const tableBody = document.querySelector('#data-table tbody');
        if (!tableHead || !tableBody) return;

        tableHead.innerHTML = '';
        tableBody.innerHTML = '';
        
        const trHead = document.createElement('tr');
        allColumns.forEach(col => {
            const th = document.createElement('th');
            th.className = 'py-2 px-4 border-b text-left sticky top-0 bg-gray-200';
            th.textContent = col;
            if (!defaultColumns.includes(col)) {
                th.style.display = 'none';
            }
            trHead.appendChild(th);
        });
        tableHead.appendChild(trHead);

        tableData.forEach(row => {
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-gray-100';
            allColumns.forEach((col) => {
                const td = document.createElement('td');
                td.className = 'py-2 px-4 border-b';
                
                if (col === 'resume_path' && row[col]) {
                    const link = document.createElement('a');
                    link.href = `/uploads/${row[col]}`;
                    link.textContent = 'View Resume';
                    link.target = '_blank';
                    link.className = 'text-blue-600 hover:underline';
                    td.appendChild(link);
                } else {
                    td.textContent = row[col] || '';
                }

                if (!defaultColumns.includes(col)) {
                    td.style.display = 'none';
                }
                if (col.toLowerCase() === 'name'){ 
                    td.classList.add('font-bold', 'cursor-pointer', 'text-blue-600', 'hover:underline');
                    td.addEventListener('click', () => showDetailsModal(row));      
                }
                tr.appendChild(td);
            });
            tableBody.appendChild(tr);
        });
    }
    
    function populateStatusModal(tableData = []) {
        const modalBody = document.querySelector('#status-modal-body');
        if (!modalBody) return;
        modalBody.innerHTML = '';
        const statuses = ['Applied', 'Shortlisted', 'Interviewed', 'Offered', 'Hired', 'Rejected'];

        const uniqueCandidates = [];
        const seenEmails = new Set();

        tableData.forEach(row => {
            const email = row.email;
            if (email && !seenEmails.has(email.toLowerCase())) {
                seenEmails.add(email.toLowerCase());
                uniqueCandidates.push(row);
            }
        });

        uniqueCandidates.forEach(row => {
            const tr = document.createElement('tr');
            const sanitizedEmail = row.email.replace(/[^a-zA-Z0-9]/g, "");
            const selectId = `status-select-${sanitizedEmail}`;
            let optionsHtml = statuses.map(s => `<option value="${s}" ${row.Status === s ? 'selected' : ''}>${s}</option>`).join('');
            
            tr.innerHTML = `
                <td class="py-2 px-4">${row.name || 'N/A'}</td>
                <td class="py-2 px-4">${row.email}</td>
                <td class="py-2 px-4">
                    <div class="flex items-center">
                        <select id="${selectId}" data-email="${row.email}" data-name="${row.name}" class="status-select border rounded p-1 w-full">${optionsHtml}</select>
                        <span class="feedback-span ml-2 text-sm w-16 text-center"></span>
                    </div>
                </td>
            `;
            modalBody.appendChild(tr);
        });
        
        document.querySelectorAll('.status-select').forEach(select => {
            select.addEventListener('change', handleStatusChange);
        });
    }
    
    function populateColumnSelector(allColumns = [], defaultColumns = []) {
        const optionsContainer = document.getElementById('column-selector-options');
        if (!optionsContainer) return;
        optionsContainer.innerHTML = ''; 

        allColumns.forEach(col => {
            const label = document.createElement('label');
            label.className = 'flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 cursor-pointer';
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'mr-3 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500';
            checkbox.value = col;
            checkbox.checked = defaultColumns.includes(col);
            checkbox.addEventListener('change', handleColumnVisibilityChange);

            label.appendChild(checkbox);
            label.appendChild(document.createTextNode(col));
            optionsContainer.appendChild(label);
        });
    }

    function populateFilterOptions(filters = {}) {
        const populate = (id, options, selectedValue) => {
            const select = document.getElementById(id);
            if (!select) return;
            while (select.options.length > 1) select.remove(1);
            options.forEach(opt => select.add(new Option(opt, opt)));
            if (selectedValue) select.value = selectedValue;
            select.dataset.populated = 'true';
        };
        populate('location-filter', filters.locations || []);
        populate('post-filter', filters.posts || []);
        populate('qualification-filter', filters.qualifications || []);
        populate('business-entity-filter', filters.business_entities || []);
        populate('course-filter', filters.courses || []);
        populate('college-filter', filters.colleges || []);
    }
    
    function updateAllCharts(chartData = {}) {
        // Add loading state to all chart containers
        document.querySelectorAll('.chart-container').forEach(container => {
            container.classList.add('loading');
        });
        const chartConfigs = {
            appsPerCompanyChart: { 
                type: 'bar', 
                label: 'Apps per Company', 
                data: chartData.apps_per_company, 
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    aspectRatio: 2,
                    scales: {
                        y: {
                            beginAtZero: true,
                            grid: {
                                color: 'rgba(0, 0, 0, 0.1)'
                            }
                        },
                        x: {
                            grid: {
                                display: false
                            }
                        }
                    }
                }
            },
            appsPerCollegeChart: { 
                type: 'bar', 
                label: 'Apps per College', 
                data: chartData.apps_per_college, 
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    aspectRatio: 2,
                    scales: {
                        y: {
                            beginAtZero: true,
                            grid: {
                                color: 'rgba(0, 0, 0, 0.1)'
                            }
                        },
                        x: {
                            grid: {
                                display: false
                            }
                        }
                    }
                }
            },
            genderDiversityChart: { 
                type: 'pie', 
                label: 'Gender Diversity', 
                data: chartData.gender_diversity, 
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    aspectRatio: 1,
                    plugins: {
                        legend: {
                            position: 'bottom'
                        }
                    }
                }
            },
            recruitmentFunnelChart: { 
                type: 'funnel', 
                label: 'Recruitment Funnel', 
                data: chartData.recruitment_funnel, 
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    aspectRatio: 1.5
                }
            }
        };

        if (window.ChartDataLabels) {
            Chart.register(window.ChartDataLabels);
        }

        for (const [canvasId, config] of Object.entries(chartConfigs)) {
            const chartInstance = charts[canvasId];
            const data = config.data || {};
            
            if (config.type === 'funnel') {
                const funnelData = chartData.recruitment_funnel || { labels: [], data: [] };
                const funnelLabels = funnelData.labels;
                const funnelValues = funnelData.data;

                const maxValue = Math.max(...funnelValues, 0);
                const spacerData = funnelValues.map(value => (maxValue - value) / 2);

                const newChartData = {
                    labels: funnelLabels,
                    datasets: [{
                        label: 'Spacer',
                        data: spacerData,
                        backgroundColor: 'transparent',
                        stack: 'funnelStack'
                    }, {
                        label: 'Count',
                        data: funnelValues,
                        backgroundColor: ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#FF9F40'],
                        stack: 'funnelStack'
                    }]
                };

                if (chartInstance) {
                    chartInstance.destroy();
                }
                const canvas = document.getElementById(canvasId);
                const ctx = canvas?.getContext('2d');
                if (!ctx || !canvas) continue;
                
                // Ensure canvas has proper dimensions before creating chart
                const container = canvas.parentElement;
                                 if (container && container.classList.contains('chart-container')) {
                     canvas.style.width = '100%';
                     canvas.style.height = '100%';
                     container.classList.remove('loading');
                 }

                charts[canvasId] = new Chart(ctx, {
                    type: 'bar',
                    data: newChartData,
                    options: {
                        indexAxis: 'y', 
                        responsive: true, 
                        maintainAspectRatio: false,
                        aspectRatio: config.options.aspectRatio || 1.5,
                        scales: { 
                            x: { 
                                stacked: true, 
                                grid: { display: false }, 
                                ticks: { display: false } 
                            }, 
                            y: { 
                                stacked: true, 
                                grid: { display: false } 
                            } 
                        },
                        plugins: {
                            legend: { display: false }, 
                            title: { display: true, text: 'Recruitment Funnel' },
                            tooltip: { filter: (item) => item.datasetIndex === 1 },
                            datalabels: {
                                color: 'white', 
                                font: { weight: 'bold', size: 14, },
                                formatter: (value, context) => context.chart.data.datasets[1].data[context.dataIndex],
                                display: (context) => context.datasetIndex === 1
                            }
                        }
                    }
                });

            } else {
                const labels = (config.data && config.data.labels) ? config.data.labels : Object.keys(data);
                const values = (config.data && config.data.data) ? config.data.data : Object.values(data);

                if (chartInstance) {
                    chartInstance.data.labels = labels;
                    chartInstance.data.datasets[0].data = values;
                    chartInstance.update();
                } else {
                    const canvas = document.getElementById(canvasId);
                    const ctx = canvas?.getContext('2d');
                    if (!ctx || !canvas) continue;
                    
                    // Ensure canvas has proper dimensions before creating chart
                    const container = canvas.parentElement;
                    if (container && container.classList.contains('chart-container')) {
                        canvas.style.width = '100%';
                        canvas.style.height = '100%';
                        container.classList.remove('loading');
                    }
                    charts[canvasId] = new Chart(ctx, {
                        type: config.type,
                        data: { 
                            labels: labels, 
                            datasets: [{ 
                                label: 'Count', 
                                data: values, 
                                backgroundColor: config.type === 'pie' ? 
                                    ['#36A2EB', '#FF6384', '#FFCE56', '#4BC0C0', '#9966FF', '#FF9F40'] : 
                                    '#36A2EB',
                                borderColor: config.type === 'pie' ? 
                                    ['#36A2EB', '#FF6384', '#FFCE56', '#4BC0C0', '#9966FF', '#FF9F40'] : 
                                    '#36A2EB',
                                borderWidth: 1
                            }] 
                        },
                        options: { 
                            ...config.options, 
                            plugins: { 
                                ...config.options.plugins,
                                title: { display: true, text: config.label } 
                            } 
                        }
                    });
                }
            }
        }
    }

    // --- UI State Helpers ---
    const showLoading = (isLoading) => {
        const loadingOverlay = document.getElementById('loading-overlay');
        if (loadingOverlay) {
            loadingOverlay.classList.toggle('hidden', !isLoading);
        }
    };
    const hideError = () => {
        const errorDisplay = document.getElementById('error-display');
        if (errorDisplay) {
            errorDisplay.classList.add('hidden');
        }
    };
    const showError = (message) => {
        const errorDisplay = document.getElementById('error-display');
        if (errorDisplay) {
            errorDisplay.innerHTML = `<div class="p-4 bg-red-100 border border-red-400 text-red-700 rounded-lg">${message}</div>`;
            errorDisplay.classList.remove('hidden');
        }
    };

    // --- Event Handlers ---
    
    function handleColumnVisibilityChange() {
        const selectedColumns = Array.from(document.querySelectorAll('#column-selector-options input:checked')).map(cb => cb.value);
        const table = document.getElementById('data-table');
        if (!table) return;

        table.querySelectorAll('thead th').forEach((th, index) => {
            const isVisible = selectedColumns.includes(th.textContent);
            th.style.display = isVisible ? '' : 'none';
            table.querySelectorAll('tbody tr').forEach(tr => {
                if (tr.children[index]) {
                    tr.children[index].style.display = isVisible ? '' : 'none';
                }
            });
        });
    }

    async function showDetailsModal(rowData) {
        const modal = document.getElementById('details-modal');
        const modalBody = modal.querySelector('#modal-body-content');
        if (!modalBody || !modal) return;
        
        modalBody.innerHTML = '<div class="flex justify-center items-center py-4"><div class="loading-spinner"></div><span class="ml-2 text-gray-600">Loading details...</span></div>';
        modal.classList.remove('hidden');

        try {
            // Fetch form configuration to organize data by subsections
            const response = await fetch('/api/form/config');
            const formFields = response.ok ? await response.json() : [];
            
            // Create field mapping with subsection info
            const fieldMap = {};
            formFields.forEach(field => {
                fieldMap[field.name] = {
                    label: field.label,
                    subsection: field.subsection || 'Other Information',
                    type: field.type,
                    order: field.field_order || 999
                };
            });

            // Add special handling for fields not in config
            const specialFields = {
                'id': { label: 'ID', subsection: 'Basic Information', type: 'text', order: 0 },
                'submission_timestamp': { label: 'Submission Date', subsection: 'Basic Information', type: 'datetime', order: 1 },
                'Status': { label: 'Application Status', subsection: 'Basic Information', type: 'text', order: 2 },
                'resume_path': { label: 'Resume', subsection: 'Documents', type: 'file', order: 0 }
            };

            // Merge special fields with form config
            Object.entries(specialFields).forEach(([key, value]) => {
                if (!fieldMap[key]) {
                    fieldMap[key] = value;
                }
            });

            // Group data by subsections
            const subsections = {};
            Object.entries(rowData).forEach(([key, value]) => {
                const fieldInfo = fieldMap[key] || { 
                    label: formatFieldName(key), 
                    subsection: 'Other Information', 
                    type: 'text',
                    order: 999 
                };
                
                if (!subsections[fieldInfo.subsection]) {
                    subsections[fieldInfo.subsection] = [];
                }
                
                subsections[fieldInfo.subsection].push({
                    key,
                    label: fieldInfo.label,
                    value,
                    type: fieldInfo.type,
                    order: fieldInfo.order
                });
            });

            // Sort fields within each subsection by order
            Object.keys(subsections).forEach(subsection => {
                subsections[subsection].sort((a, b) => a.order - b.order);
            });

            // Clear loading and render organized content
            modalBody.innerHTML = '';
            
            // Define subsection order
            const subsectionOrder = [
                'Basic Information',
                'Personal Details',
                'Contact & Position',
                "Spouse's Details",
                'Academic Qualifications',
                'Additional Information',
                'Documents',
                'Other Information'
            ];

            // Render subsections in order
            subsectionOrder.forEach(subsectionName => {
                if (subsections[subsectionName] && subsections[subsectionName].length > 0) {
                    renderSubsection(modalBody, subsectionName, subsections[subsectionName]);
                }
            });

            // Render any remaining subsections not in the predefined order
            Object.keys(subsections).forEach(subsectionName => {
                if (!subsectionOrder.includes(subsectionName) && subsections[subsectionName].length > 0) {
                    renderSubsection(modalBody, subsectionName, subsections[subsectionName]);
                }
            });

            // Initialize search functionality
            initializeDetailsSearch();
            initializePrintFunctionality();
            updateVisibleSectionsCount();

        } catch (error) {
            console.error('Error loading candidate details:', error);
            modalBody.innerHTML = `
                <div class="text-center py-8">
                    <div class="text-red-600 mb-2">
                        <svg class="mx-auto h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    </div>
                    <p class="text-gray-600">Unable to load candidate details</p>
                    <button onclick="showDetailsModal(${JSON.stringify(rowData).replace(/"/g, '&quot;')})" class="mt-2 text-blue-600 hover:underline text-sm">Try Again</button>
                </div>
            `;
        }
    }

    function renderSubsection(container, subsectionName, fields) {
        const subsectionDiv = document.createElement('div');
        subsectionDiv.className = 'candidate-subsection mb-6 bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl p-5 border border-gray-200';
        
        // Subsection header
        const header = document.createElement('h3');
        header.className = 'subsection-header text-xl font-bold mb-4 pb-3 border-b-2 border-gradient-to-r from-blue-400 to-purple-500';
        
        // Add appropriate icons for different sections
        const sectionIcons = {
            'Basic Information': 'fas fa-info-circle',
            'Personal Details': 'fas fa-user',
            'Contact & Position': 'fas fa-briefcase',
            "Spouse's Details": 'fas fa-heart',
            'Academic Qualifications': 'fas fa-graduation-cap',
            'Additional Information': 'fas fa-plus-circle',
            'Documents': 'fas fa-file-alt',
            'Other Information': 'fas fa-ellipsis-h'
        };
        
        const iconClass = sectionIcons[subsectionName] || 'fas fa-folder-open';
        header.innerHTML = `<i class="${iconClass} mr-3 text-blue-600"></i>${subsectionName}`;
        subsectionDiv.appendChild(header);

        // Fields grid
        const fieldsGrid = document.createElement('div');
        fieldsGrid.className = 'grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4';

        fields.forEach(field => {
            const fieldDiv = document.createElement('div');
            fieldDiv.className = 'candidate-field bg-white p-4 rounded-lg border border-gray-200 shadow-sm';

            const label = document.createElement('div');
            label.className = 'text-sm font-semibold text-gray-700 mb-2 uppercase tracking-wide';
            label.textContent = field.label;

            const value = document.createElement('div');
            value.className = 'text-gray-900 font-medium';

            // Handle different field types with enhanced styling
            if (field.key === 'resume_path' && field.value) {
                value.innerHTML = `<a href="/uploads/${field.value}" target="_blank" class="resume-link">
                    <i class="fas fa-file-pdf mr-2"></i>View Resume
                </a>`;
            } else if (field.type === 'datetime' && field.value) {
                const date = new Date(field.value);
                value.innerHTML = `<div class="flex items-center">
                    <i class="fas fa-clock mr-2 text-gray-500"></i>
                    <span>${date.toLocaleString()}</span>
                </div>`;
            } else if (field.type === 'date' && field.value) {
                const date = new Date(field.value);
                value.innerHTML = `<div class="flex items-center">
                    <i class="fas fa-calendar mr-2 text-gray-500"></i>
                    <span>${date.toLocaleDateString()}</span>
                </div>`;
            } else if (field.key === 'Status') {
                const statusConfig = {
                    'Applied': { class: 'bg-blue-100 text-blue-800 border-blue-200', icon: 'fas fa-paper-plane' },
                    'Shortlisted': { class: 'bg-yellow-100 text-yellow-800 border-yellow-200', icon: 'fas fa-star' },
                    'Interviewed': { class: 'bg-purple-100 text-purple-800 border-purple-200', icon: 'fas fa-comments' },
                    'Offered': { class: 'bg-green-100 text-green-800 border-green-200', icon: 'fas fa-handshake' },
                    'Hired': { class: 'bg-green-200 text-green-900 border-green-300', icon: 'fas fa-check-circle' },
                    'Rejected': { class: 'bg-red-100 text-red-800 border-red-200', icon: 'fas fa-times-circle' }
                };
                const config = statusConfig[field.value] || { class: 'bg-gray-100 text-gray-800 border-gray-200', icon: 'fas fa-question' };
                value.innerHTML = `<span class="status-badge inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold border ${config.class}">
                    <i class="${config.icon} mr-2"></i>${field.value || 'Applied'}
                </span>`;
            } else if (field.type === 'email' && field.value) {
                value.innerHTML = `<div class="flex items-center">
                    <i class="fas fa-envelope mr-2 text-gray-500"></i>
                    <a href="mailto:${field.value}" class="text-blue-600 hover:text-blue-800 hover:underline">${field.value}</a>
                </div>`;
            } else if (field.type === 'tel' && field.value) {
                value.innerHTML = `<div class="flex items-center">
                    <i class="fas fa-phone mr-2 text-gray-500"></i>
                    <a href="tel:${field.value}" class="text-blue-600 hover:text-blue-800 hover:underline">${field.value}</a>
                </div>`;
            } else if (field.type === 'textarea' && field.value) {
                value.innerHTML = `<div class="bg-gray-50 p-3 rounded-md border border-gray-200">
                    <p class="text-sm leading-relaxed">${field.value}</p>
                </div>`;
            } else {
                if (field.value) {
                    value.innerHTML = `<span class="text-gray-900">${field.value}</span>`;
                } else {
                    value.innerHTML = `<span class="text-gray-400 italic">Not provided</span>`;
                }
            }

            // Handle long text fields - make them span more columns
            if (field.type === 'textarea' && field.value && field.value.length > 100) {
                fieldDiv.className = 'candidate-field bg-white p-4 rounded-lg border border-gray-200 shadow-sm lg:col-span-2 xl:col-span-3';
            }

            // Add special styling for important fields
            if (['name', 'email', 'Status'].includes(field.key)) {
                fieldDiv.className += ' ring-2 ring-blue-100';
            }

            fieldDiv.appendChild(label);
            fieldDiv.appendChild(value);
            fieldsGrid.appendChild(fieldDiv);
        });

        subsectionDiv.appendChild(fieldsGrid);
        container.appendChild(subsectionDiv);
    }

    function formatFieldName(fieldName) {
        return fieldName
            .split('_')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }

    function initializeDetailsSearch() {
        const searchInput = document.getElementById('details-search');
        const clearButton = document.getElementById('clear-details-search');
        
        if (searchInput) {
            searchInput.addEventListener('input', function() {
                const searchTerm = this.value.toLowerCase();
                filterDetailsContent(searchTerm);
                
                // Show/hide clear button
                if (clearButton) {
                    if (this.value.length > 0) {
                        clearButton.classList.remove('hidden');
                    } else {
                        clearButton.classList.add('hidden');
                    }
                }
            });
        }

        if (clearButton) {
            clearButton.addEventListener('click', function() {
                if (searchInput) {
                    searchInput.value = '';
                    filterDetailsContent('');
                    this.classList.add('hidden');
                    searchInput.focus();
                }
            });
        }
    }

    function filterDetailsContent(searchTerm) {
        const subsections = document.querySelectorAll('.candidate-subsection');
        let visibleSections = 0;

        subsections.forEach(subsection => {
            const subsectionText = subsection.textContent.toLowerCase();
            const shouldShow = !searchTerm || subsectionText.includes(searchTerm);
            
            if (shouldShow) {
                subsection.style.display = 'block';
                visibleSections++;
                
                // Also filter individual fields within visible subsections
                const fields = subsection.querySelectorAll('.candidate-field');
                fields.forEach(field => {
                    const fieldText = field.textContent.toLowerCase();
                    const fieldShouldShow = !searchTerm || fieldText.includes(searchTerm);
                    field.style.display = fieldShouldShow ? 'block' : 'none';
                });
            } else {
                subsection.style.display = 'none';
            }
        });

        updateVisibleSectionsCount(visibleSections, subsections.length);
    }

    function updateVisibleSectionsCount(visible = null, total = null) {
        const countElement = document.getElementById('visible-sections-count');
        if (countElement) {
            if (visible === null) {
                const subsections = document.querySelectorAll('.candidate-subsection');
                visible = subsections.length;
                total = subsections.length;
            }
            
            if (visible === total) {
                countElement.textContent = `Showing all ${total} sections`;
            } else {
                countElement.textContent = `Showing ${visible} of ${total} sections`;
            }
        }
    }

    function initializePrintFunctionality() {
        const printButton = document.getElementById('print-details-btn');
        if (printButton) {
            printButton.addEventListener('click', function() {
                printCandidateDetails();
            });
        }
    }

    function printCandidateDetails() {
        const modalContent = document.getElementById('modal-body-content');
        const candidateName = document.querySelector('.candidate-subsection .candidate-field span')?.textContent || 'Candidate';
        
        if (modalContent) {
            const printWindow = window.open('', '_blank');
            printWindow.document.write(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>${candidateName} - Details</title>
                    <style>
                        body { font-family: Arial, sans-serif; margin: 20px; color: #333; }
                        .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #333; padding-bottom: 10px; }
                        .subsection { margin-bottom: 25px; page-break-inside: avoid; }
                        .subsection-header { font-size: 18px; font-weight: bold; color: #333; margin-bottom: 15px; border-bottom: 1px solid #ccc; padding-bottom: 5px; }
                        .fields-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 15px; }
                        .field { border: 1px solid #e0e0e0; padding: 10px; border-radius: 4px; }
                        .field-label { font-weight: bold; font-size: 12px; color: #666; text-transform: uppercase; margin-bottom: 5px; }
                        .field-value { font-size: 14px; color: #333; }
                        .status-badge { padding: 4px 8px; border-radius: 12px; font-size: 12px; font-weight: bold; }
                        .resume-link { color: #0066cc; text-decoration: none; }
                        @media print { 
                            body { margin: 0; } 
                            .subsection { page-break-inside: avoid; }
                        }
                    </style>
                </head>
                <body>
                    <div class="header">
                        <h1>Candidate Details: ${candidateName}</h1>
                        <p>Generated on ${new Date().toLocaleString()}</p>
                    </div>
                    ${modalContent.innerHTML.replace(/candidate-subsection/g, 'subsection')
                        .replace(/candidate-field/g, 'field')
                        .replace(/subsection-header/g, 'subsection-header')
                        .replace(/text-sm font-semibold text-gray-700 mb-2 uppercase tracking-wide/g, 'field-label')
                        .replace(/text-gray-900 font-medium/g, 'field-value')
                        .replace(/grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4/g, 'fields-grid')}
                </body>
                </html>
            `);
            printWindow.document.close();
            printWindow.focus();
            setTimeout(() => {
                printWindow.print();
                printWindow.close();
            }, 250);
        }
    }

    async function handleStatusChange(event) {
        const selectElement = event.target;
        const feedbackSpan = selectElement.parentElement.querySelector('.feedback-span');
        const { email, name } = selectElement.dataset;
        const status = selectElement.value;

        selectElement.disabled = true;
        feedbackSpan.textContent = 'Saving...';
        feedbackSpan.className = 'feedback-span ml-2 text-sm w-16 text-center text-gray-500';

        try {
            const response = await fetch('/api/update_status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, name, status }),
            });
            if (!response.ok) throw new Error('Server responded with an error.');
            
            feedbackSpan.textContent = 'Saved!';
            feedbackSpan.classList.add('text-green-600');
        } catch (error) {
            feedbackSpan.textContent = 'Error!';
            feedbackSpan.classList.add('text-red-600');
        } finally {
            setTimeout(() => {
                selectElement.disabled = false;
                if(feedbackSpan.textContent !== 'Error!') feedbackSpan.textContent = '';
            }, 2000);
        }
    }

    async function openUserManagementModal() {
        try {
            const response = await fetch('/api/users');
            if (!response.ok) throw new Error('Failed to fetch users.');
            const users = await response.json();
            populateUserList(users);
            const modal = document.getElementById('user-management-modal');
        if (modal) {
            modal.classList.remove('hidden');
        }
        } catch (error) {
            alert(`Could not load user data: ${error.message}`);
        }
    }

    function populateUserList(users = []) {
        const userListBody = document.getElementById('user-list-body');
        if (!userListBody) return;
        userListBody.innerHTML = '';

        users.forEach(user => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="py-2 px-4">${user.email}</td>
                <td class="py-2 px-4 capitalize">${user.role}</td>
                <td class="py-2 px-4">
                    ${user.role !== 'admin' ? `<button class="delete-user-btn text-red-500 hover:underline text-sm" data-user-id="${user.id}">Delete</button>` : '<span class="text-gray-400 text-sm">Cannot Delete</span>'}
                </td>
            `;
            userListBody.appendChild(tr);
        });

        document.querySelectorAll('.delete-user-btn').forEach(btn => btn.addEventListener('click', handleDeleteUser));
    }

    async function handleAddViewer(event) {
        event.preventDefault();
        const feedbackEl = document.getElementById('add-user-feedback');
        const emailInput = document.getElementById('new-viewer-email');
        const passwordInput = document.getElementById('new-viewer-password');
        
        feedbackEl.textContent = 'Adding...';
        feedbackEl.className = 'text-sm mt-2 text-gray-600';

        try {
            const response = await fetch('/api/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: emailInput.value, password: passwordInput.value }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Failed to add user.');

            feedbackEl.textContent = result.message;
            feedbackEl.classList.add('text-green-600');
            emailInput.value = '';
            passwordInput.value = '';
            openUserManagementModal();
        } catch (error) {
            feedbackEl.textContent = `Error: ${error.message}`;
            feedbackEl.className = 'text-sm mt-2 text-red-600';
        }
    }

    async function handleDeleteUser(event) {
        const userId = event.target.dataset.userId;
        if (!confirm('Are you sure you want to delete this user?')) return;

        try {
            const response = await fetch('/api/users/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: userId }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Failed to delete user.');
            openUserManagementModal();
        } catch (error) {
            alert(`Could not delete user: ${error.message}`);
        }
    }

    // --- Enhanced Form Configuration Handlers ---
    let currentFields = [];
    let currentSections = [];

    async function openFormConfigModal() {
        try {
            const [fieldsResponse, sectionsResponse] = await Promise.all([
                fetch('/api/form/config'),
                fetch('/api/form/sections')
            ]);
            
            if (!fieldsResponse.ok) throw new Error('Failed to fetch form configuration.');
            if (!sectionsResponse.ok) throw new Error('Failed to fetch sections.');
            
            currentFields = await fieldsResponse.json();
            currentSections = await sectionsResponse.json();
            
            populateFieldList(currentFields);
            populateSectionsList(currentSections);
            populateExistingSections(currentSections);
                    populateSortableFields(currentFields);
        populateSortableSections(currentSections);
        populateValidationsTab(currentFields);
        
        const modal = document.getElementById('form-config-modal');
        if (modal) {
            modal.classList.remove('hidden');
        }
        
        // Initialize drag and drop after a short delay to ensure DOM is ready
        setTimeout(() => {
            console.log('Initializing drag and drop on modal open');
            initializeSectionDragAndDrop();
            initializeDragAndDrop();
            
            // Also initialize form config tabs
            initializeFormConfigTabs();
        }, 300);
        } catch (error) {
            alert(`Could not load form configuration: ${error.message}`);
        }
    }

    function populateFieldList(fields = []) {
        const fieldListBody = document.getElementById('field-list-body');
        if (!fieldListBody) return;
        fieldListBody.innerHTML = '';

        fields.forEach((field, index) => {
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-gray-50 transition-colors duration-200';
            
            const fieldTypeBadge = `<span class="field-type-badge field-type-${field.type}">${field.type}</span>`;
            const coreIndicator = field.is_core ? '<i class="fas fa-lock text-gray-400 ml-1" title="Core field - cannot be deleted"></i>' : '';
            
            tr.innerHTML = `
                <td class="py-4 px-4 text-center">
                    <span class="inline-flex items-center justify-center w-8 h-8 bg-blue-100 text-blue-800 rounded-full text-sm font-semibold">
                        ${field.field_order || index + 1}
                    </span>
                </td>
                <td class="py-4 px-4">
                    <div class="flex items-center">
                        <code class="bg-gray-100 px-2 py-1 rounded text-sm font-mono text-gray-800">${field.name}</code>
                        ${coreIndicator}
                    </div>
                </td>
                <td class="py-4 px-4">
                    <span class="font-medium text-gray-900">${field.label}</span>
                </td>
                <td class="py-4 px-4">
                    <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                        <i class="fas fa-folder mr-1"></i>${field.subsection || 'N/A'}
                    </span>
                </td>
                <td class="py-4 px-4">${fieldTypeBadge}</td>
                <td class="py-4 px-4 text-center">
                    <label class="inline-flex items-center cursor-pointer ${field.is_core ? 'opacity-50 cursor-not-allowed' : ''}">
                        <input type="checkbox" ${field.required ? 'checked' : ''} 
                               class="sr-only field-required-toggle" 
                               data-field-id="${field.id}" ${field.is_core ? 'disabled' : ''}>
                        <div class="toggle-switch ${field.is_core ? 'pointer-events-none' : ''}"></div>
                    </label>
                </td>
                <td class="py-4 px-4">
                    <div class="flex items-center justify-center space-x-2">
                        <button class="edit-field-btn inline-flex items-center px-3 py-1.5 bg-blue-100 text-blue-700 rounded-md hover:bg-blue-200 transition-colors duration-200 text-sm font-medium" data-field-id="${field.id}">
                            <i class="fas fa-edit mr-1"></i>Edit
                        </button>
                        ${!field.is_core ? 
                            `<button class="delete-field-btn inline-flex items-center px-3 py-1.5 bg-red-100 text-red-700 rounded-md hover:bg-red-200 transition-colors duration-200 text-sm font-medium" data-field-id="${field.id}">
                                <i class="fas fa-trash mr-1"></i>Delete
                            </button>` : 
                            '<span class="inline-flex items-center px-3 py-1.5 bg-gray-100 text-gray-500 rounded-md text-sm font-medium"><i class="fas fa-shield-alt mr-1"></i>Protected</span>'
                        }
                    </div>
                </td>
            `;
            fieldListBody.appendChild(tr);
        });

        // Update fields count
        const fieldsCount = document.getElementById('fields-count');
        if (fieldsCount) {
            fieldsCount.textContent = `${fields.length} fields`;
        }

        // Add event listeners
        document.querySelectorAll('.delete-field-btn').forEach(btn => btn.addEventListener('click', handleDeleteField));
        document.querySelectorAll('.edit-field-btn').forEach(btn => btn.addEventListener('click', handleEditField));
        document.querySelectorAll('.field-required-toggle').forEach(toggle => toggle.addEventListener('change', handleRequiredToggle));
    }

    function populateSectionsList(sections = []) {
        const sectionsList = document.getElementById('sections-list');
        const sectionsCount = document.getElementById('sections-count');
        
        if (!sectionsList) return;
        sectionsList.innerHTML = '';

        // Handle both old format (array of strings) and new format (array of objects)
        const normalizedSections = sections.map(section => {
            if (typeof section === 'string') {
                return { name: section, description: '', icon: 'folder', order: 0 };
            }
            return section;
        });

        if (sectionsCount) {
            sectionsCount.textContent = `${normalizedSections.length} sections`;
        }

        if (normalizedSections.length === 0) {
            sectionsList.innerHTML = `
                <div class="text-center py-8 text-gray-500">
                    <i class="fas fa-layer-group text-2xl mb-2"></i>
                    <p class="text-sm">No sections created yet</p>
                    <p class="text-xs">Create your first section above</p>
                </div>
            `;
            return;
        }

        normalizedSections.forEach(section => {
            const div = document.createElement('div');
            div.className = 'section-item bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-all duration-200';
            
            const iconMap = {
                'folder': '📁', 'user': '👤', 'briefcase': '💼', 'graduation-cap': '🎓',
                'phone': '📞', 'file-alt': '📄', 'cog': '⚙️', 'star': '⭐'
            };
            
            div.innerHTML = `
                <div class="flex items-start justify-between">
                    <div class="flex-1">
                        <div class="flex items-center mb-2">
                            <span class="text-lg mr-2">${iconMap[section.icon] || '📁'}</span>
                            <h6 class="font-semibold text-gray-800">${section.name}</h6>
                        </div>
                        ${section.description ? `<p class="text-sm text-gray-600 mb-2">${section.description}</p>` : ''}
                        <p class="text-xs text-gray-500">
                            ${getFieldCountForSection(section.name)} fields
                        </p>
                    </div>
                    <div class="flex items-center space-x-2 ml-4">
                        <button class="edit-section-btn text-blue-600 hover:text-blue-800 p-1 rounded" 
                                data-section="${section.name}" title="Edit Section">
                            <i class="fas fa-edit text-sm"></i>
                        </button>
                        <button class="delete-section-btn text-red-600 hover:text-red-800 p-1 rounded" 
                                data-section="${section.name}" title="Delete Section">
                            <i class="fas fa-trash text-sm"></i>
                        </button>
                    </div>
                </div>
            `;
            sectionsList.appendChild(div);
        });

        // Add event listeners
        document.querySelectorAll('.edit-section-btn').forEach(btn => btn.addEventListener('click', handleEditSection));
        document.querySelectorAll('.delete-section-btn').forEach(btn => btn.addEventListener('click', handleDeleteSection));
        
        // Populate sortable sections
        populateSortableSections(normalizedSections);
    }

    function getFieldCountForSection(sectionName) {
        return currentFields.filter(field => field.subsection === sectionName).length;
    }

    function populateSortableSections(sections = []) {
        const sortableContainer = document.getElementById('sortable-sections');
        if (!sortableContainer) return;
        sortableContainer.innerHTML = '';

        const sortedSections = [...sections].sort((a, b) => (a.order || 0) - (b.order || 0));
        
        sortedSections.forEach((section, index) => {
            const div = document.createElement('div');
            div.className = 'sortable-section-item bg-gray-50 border border-gray-200 rounded-lg p-3 cursor-move hover:bg-gray-100 transition-colors duration-200';
            div.draggable = true;
            div.dataset.sectionName = section.name;
            
            // Add debug attribute
            div.setAttribute('title', `Section: ${section.name}, Order: ${section.order || 0}`);
            
            const iconMap = {
                'folder': '📁', 'user': '👤', 'briefcase': '💼', 'graduation-cap': '🎓',
                'phone': '📞', 'file-alt': '📄', 'cog': '⚙️', 'star': '⭐'
            };
            
            div.innerHTML = `
                <div class="flex items-center justify-between">
                    <div class="flex items-center">
                        <i class="fas fa-grip-vertical text-gray-400 mr-3 cursor-grab"></i>
                        <span class="text-lg mr-2">${iconMap[section.icon] || '📁'}</span>
                        <span class="font-medium text-gray-800">${section.name}</span>
                        <span class="ml-2 text-sm text-gray-500">(${getFieldCountForSection(section.name)} fields)</span>
                    </div>
                    <span class="section-order-number text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded-full">#${index + 1}</span>
                </div>
            `;
            sortableContainer.appendChild(div);
        });

        console.log(`Populated ${sortedSections.length} sortable section items`);
    }

    function populateExistingSections(sections = []) {
        const datalists = ['existing-sections', 'existing-sections-edit'];
        datalists.forEach(id => {
            const datalist = document.getElementById(id);
            if (datalist) {
                datalist.innerHTML = '';
                sections.forEach(section => {
                    const option = document.createElement('option');
                    // Handle both old format (string) and new format (object)
                    const sectionName = typeof section === 'string' ? section : section.name;
                    option.value = sectionName;
                    option.textContent = sectionName;
                    datalist.appendChild(option);
                });
            }
        });
    }

    function populateSortableFields(fields = []) {
        const sortableContainer = document.getElementById('sortable-fields');
        if (!sortableContainer) return;
        sortableContainer.innerHTML = '';

        const sortedFields = [...fields].sort((a, b) => (a.field_order || 0) - (b.field_order || 0));
        
        sortedFields.forEach(field => {
            const div = document.createElement('div');
            div.className = 'sortable-field-item';
            div.draggable = true;
            div.dataset.fieldId = field.id;
            
            // Add debug attribute
            div.setAttribute('title', `Field ID: ${field.id}, Order: ${field.field_order || 0}`);
            div.innerHTML = `
                <div class="flex items-center justify-between">
                    <div class="flex items-center">
                        <i class="fas fa-grip-vertical drag-handle mr-3"></i>
                        <span class="font-medium">${field.label}</span>
                        <span class="ml-2 text-sm text-gray-500">(${field.name})</span>
                    </div>
                    <span class="field-type-badge field-type-${field.type}">${field.type}</span>
                </div>
            `;
            sortableContainer.appendChild(div);
        });

        console.log(`Populated ${sortedFields.length} sortable field items`);
    }

    function populateValidationsTab(fields = []) {
        const validationsContainer = document.getElementById('validations-container');
        if (!validationsContainer) return;
        validationsContainer.innerHTML = '';

        fields.forEach(field => {
            const div = document.createElement('div');
            div.className = 'bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl p-6 border border-gray-200 shadow-sm';
            const validations = field.validations ? JSON.parse(field.validations) : {};
            
            div.innerHTML = `
                <div class="flex justify-between items-start mb-4">
                    <div>
                        <h5 class="text-lg font-bold text-gray-800 flex items-center">
                            <i class="fas fa-edit mr-2 text-blue-600"></i>${field.label}
                        </h5>
                        <p class="text-sm text-gray-600 mt-1">
                            <code class="bg-white px-2 py-1 rounded text-xs">${field.name}</code>
                            <span class="mx-2">•</span>
                            <span class="field-type-badge field-type-${field.type}">${field.type}</span>
                        </p>
                    </div>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div class="form-group">
                        <label class="form-label">
                            <i class="fas fa-ruler mr-2 text-green-500"></i>Min Length
                        </label>
                        <input type="number" class="form-input-enhanced validation-input" 
                               data-field-id="${field.id}" data-rule="minLength" 
                               value="${validations.minLength || ''}" placeholder="3">
                    </div>
                    <div class="form-group">
                        <label class="form-label">
                            <i class="fas fa-ruler-combined mr-2 text-orange-500"></i>Max Length
                        </label>
                        <input type="number" class="form-input-enhanced validation-input" 
                               data-field-id="${field.id}" data-rule="maxLength" 
                               value="${validations.maxLength || ''}" placeholder="50">
                    </div>
                    <div class="md:col-span-2 form-group">
                        <label class="form-label">
                            <i class="fas fa-code mr-2 text-purple-500"></i>Pattern (RegEx)
                        </label>
                        <input type="text" class="form-input-enhanced validation-input font-mono" 
                               data-field-id="${field.id}" data-rule="pattern" 
                               value="${validations.pattern || ''}" placeholder="^[0-9]+$">
                        <p class="text-xs text-gray-500 mt-1">Regular expression pattern for validation</p>
                    </div>
                    <div class="md:col-span-2 form-group">
                        <label class="form-label">
                            <i class="fas fa-exclamation-triangle mr-2 text-red-500"></i>Custom Error Message
                        </label>
                        <input type="text" class="form-input-enhanced validation-input" 
                               data-field-id="${field.id}" data-rule="errorMessage" 
                               value="${validations.errorMessage || ''}" placeholder="Please enter a valid value">
                    </div>
                </div>
            `;
            validationsContainer.appendChild(div);
        });

        // Add validation input listeners
        document.querySelectorAll('.validation-input').forEach(input => {
            input.addEventListener('change', handleValidationChange);
        });
    }

    function initializeDragAndDrop() {
        const sortableContainer = document.getElementById('sortable-fields');
        if (!sortableContainer) {
            console.warn('sortable-fields container not found');
            return;
        }
        
        console.log('Initializing field drag and drop');
        
        // Remove existing event listeners to prevent duplicates
        sortableContainer.removeEventListener('dragstart', handleFieldDragStart);
        sortableContainer.removeEventListener('dragover', handleFieldDragOver);
        sortableContainer.removeEventListener('drop', handleFieldDrop);
        sortableContainer.removeEventListener('dragend', handleFieldDragEnd);
        
        // Add event listeners using delegation
        sortableContainer.addEventListener('dragstart', handleFieldDragStart);
        sortableContainer.addEventListener('dragover', handleFieldDragOver);
        sortableContainer.addEventListener('drop', handleFieldDrop);
        sortableContainer.addEventListener('dragend', handleFieldDragEnd);
        
        // Verify draggable items
        const draggableItems = sortableContainer.querySelectorAll('.sortable-field-item');
        console.log(`Found ${draggableItems.length} draggable field items`);
    }

    function handleFieldDragStart(e) {
        const item = e.target.closest('.sortable-field-item');
        if (!item) return;
        
        console.log('Field drag started:', item.dataset.fieldId);
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', item.dataset.fieldId);
    }

    function handleFieldDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        
        const container = e.currentTarget;
        container.classList.add('drag-over');
        
        const draggedElement = document.querySelector('.sortable-field-item.dragging');
        if (!draggedElement) return;
        
        const afterElement = getFieldAfterElement(container, e.clientY);
        
        if (afterElement == null) {
            container.appendChild(draggedElement);
        } else {
            container.insertBefore(draggedElement, afterElement);
        }
    }

    function handleFieldDrop(e) {
        e.preventDefault();
        const container = e.currentTarget;
        container.classList.remove('drag-over');
        console.log('Field drop completed');
    }

    function handleFieldDragEnd(e) {
        const item = e.target.closest('.sortable-field-item');
        if (item) {
            item.classList.remove('dragging');
        }
        
        // Remove drag-over class from all containers
        document.querySelectorAll('#sortable-fields').forEach(container => {
            container.classList.remove('drag-over');
        });
        
        console.log('Field drag ended');
    }
    
    function getFieldAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('.sortable-field-item:not(.dragging)')];
        
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    async function handleAddField(event) {
        event.preventDefault();
        const feedbackEl = document.getElementById('add-field-feedback');
        const fieldNameInput = document.getElementById('new-field-name');
        const fieldLabelInput = document.getElementById('new-field-label');
        const fieldTypeInput = document.getElementById('new-field-type');
        const fieldSubsectionInput = document.getElementById('new-field-subsection');
        const fieldOptionsInput = document.getElementById('new-field-options');
        const fieldRequiredInput = document.getElementById('new-field-required');

        const fieldName = fieldNameInput.value.trim().replace(/\s+/g, '_').toLowerCase();
        if (!fieldName) {
            alert('Field Name is required and cannot contain spaces.');
            return;
        }

        feedbackEl.textContent = 'Adding...';
        feedbackEl.className = 'text-sm mt-2 text-gray-600';

        try {
            const response = await fetch('/api/form/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    name: fieldName, 
                    label: fieldLabelInput.value, 
                    type: fieldTypeInput.value,
                    subsection: fieldSubsectionInput.value,
                    options: fieldOptionsInput.value,
                    required: fieldRequiredInput.checked
                }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Failed to add field.');
            
            feedbackEl.textContent = result.message;
            feedbackEl.className = 'text-sm mt-2 text-green-600';
            const form = document.getElementById('add-field-form');
        if (form) {
            form.reset();
        }
            toggleOptionsContainer(); // Reset options visibility
            openFormConfigModal(); // Refresh the modal
        } catch (error) {
            feedbackEl.textContent = `Error: ${error.message}`;
            feedbackEl.className = 'text-sm mt-2 text-red-600';
        }
    }

    async function handleEditField(event) {
        const fieldId = event.target.dataset.fieldId;
        const field = currentFields.find(f => f.id == fieldId);
        if (!field) return;

        // Populate edit modal
        const editFieldId = document.getElementById('edit-field-id');
        const editFieldLabel = document.getElementById('edit-field-label');
        const editFieldType = document.getElementById('edit-field-type');
        const editFieldSubsection = document.getElementById('edit-field-subsection');
        const editFieldOptions = document.getElementById('edit-field-options');
        const editFieldRequired = document.getElementById('edit-field-required');
        const editFieldValidations = document.getElementById('edit-field-validations');
        
        if (editFieldId) editFieldId.value = field.id;
        if (editFieldLabel) editFieldLabel.value = field.label;
        if (editFieldType) editFieldType.value = field.type;
        if (editFieldSubsection) editFieldSubsection.value = field.subsection || '';
        if (editFieldOptions) editFieldOptions.value = field.options || '';
        if (editFieldRequired) editFieldRequired.checked = field.required;
        if (editFieldValidations) editFieldValidations.value = field.validations || '{}';

        // Show/hide options container based on field type
        toggleEditOptionsContainer();

        const modal = document.getElementById('field-edit-modal');
        if (modal) {
            modal.classList.remove('hidden');
        }
    }

    async function handleSaveFieldEdit() {
        const fieldIdEl = document.getElementById('edit-field-id');
        const labelEl = document.getElementById('edit-field-label');
        const typeEl = document.getElementById('edit-field-type');
        const subsectionEl = document.getElementById('edit-field-subsection');
        const optionsEl = document.getElementById('edit-field-options');
        const requiredEl = document.getElementById('edit-field-required');
        const validationsEl = document.getElementById('edit-field-validations');
        
        if (!fieldIdEl || !labelEl || !typeEl || !subsectionEl || !optionsEl || !requiredEl || !validationsEl) {
            alert('Form elements not found. Please refresh the page and try again.');
            return;
        }
        
        const fieldId = fieldIdEl.value;
        const data = {
            label: labelEl.value,
            type: typeEl.value,
            subsection: subsectionEl.value,
            options: optionsEl.value,
            required: requiredEl.checked,
            validations: validationsEl.value
        };

        try {
            const response = await fetch(`/api/form/config/${fieldId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Failed to update field.');
            
            const modal = document.getElementById('field-edit-modal');
        if (modal) {
            modal.classList.add('hidden');
        }
            openFormConfigModal(); // Refresh the modal
        } catch (error) {
            alert(`Could not update field: ${error.message}`);
        }
    }

    async function handleDeleteField(event) {
        const fieldId = event.target.dataset.fieldId;
        if (!confirm('Are you sure you want to delete this field? This will remove the corresponding column and all its data from the database. This action cannot be undone.')) return;

        try {
            const response = await fetch(`/api/form/config/${fieldId}`, { method: 'DELETE' });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Failed to delete field.');
            openFormConfigModal(); // Refresh the modal
        } catch (error) {
            alert(`Could not delete field: ${error.message}`);
        }
    }

    async function handleRequiredToggle(event) {
        const fieldId = event.target.dataset.fieldId;
        const required = event.target.checked;

        try {
            const response = await fetch(`/api/form/config/${fieldId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ required })
            });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.message || errorData.error || `Server error: ${response.status}`);
            }
        } catch (error) {
            event.target.checked = !required; // Revert on error
            console.error('Error updating field required status:', error);
            
            // Try to get more specific error message
            let errorMessage = 'Unknown error occurred';
            if (error.message) {
                errorMessage = error.message;
            }
            
            alert(`Could not update field: ${errorMessage}`);
        }
    }

    async function handleSaveFieldOrder() {
        const sortableItems = document.querySelectorAll('.sortable-field-item');
        const fieldOrders = Array.from(sortableItems).map((item, index) => [
            parseInt(item.dataset.fieldId), 
            index + 1
        ]);

        console.log('Saving field order:', fieldOrders);

        if (fieldOrders.length === 0) {
            alert('No fields to reorder.');
            return;
        }

        try {
            const response = await fetch('/api/form/config/reorder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ field_orders: fieldOrders })
            });
            const result = await response.json();
            console.log('Field order response:', result);
            
            if (!response.ok) throw new Error(result.error || 'Failed to reorder fields.');
            
            alert('Field order saved successfully!');
            openFormConfigModal(); // Refresh to show new order
        } catch (error) {
            console.error('Error saving field order:', error);
            alert(`Could not save field order: ${error.message}`);
        }
    }

    async function handleValidationChange(event) {
        const fieldId = event.target.dataset.fieldId;
        const rule = event.target.dataset.rule;
        const value = event.target.value;

        const field = currentFields.find(f => f.id == fieldId);
        if (!field) return;

        let validations = {};
        try {
            validations = JSON.parse(field.validations || '{}');
        } catch (e) {
            validations = {};
        }

        if (value) {
            validations[rule] = rule === 'minLength' || rule === 'maxLength' ? parseInt(value) : value;
        } else {
            delete validations[rule];
        }

        try {
            const response = await fetch(`/api/form/config/${fieldId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ validations: JSON.stringify(validations) })
            });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.message || errorData.error || `Server error: ${response.status}`);
            }
            
            // Update local field data
            field.validations = JSON.stringify(validations);
        } catch (error) {
            console.error('Error updating validation:', error);
            alert(`Could not update validation: ${error.message || 'Unknown error occurred'}`);
        }
    }

    async function handleCreateSection() {
        const nameInput = document.getElementById('new-section-name');
        const descriptionInput = document.getElementById('new-section-description');
        const iconSelect = document.getElementById('new-section-icon');
        const button = document.getElementById('create-section-btn');
        
        const name = nameInput.value.trim();
        const description = descriptionInput.value.trim();
        const icon = iconSelect.value;
        
        if (!name) {
            alert('Please enter a section name.');
            nameInput.focus();
            return;
        }
        
        try {
            // Show loading state
            const originalText = button.innerHTML;
            button.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Creating...';
            button.disabled = true;
            
            const response = await fetch('/api/form/sections', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, description, icon })
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to create section');
            }
            
            // Show success
            button.innerHTML = '<i class="fas fa-check mr-1"></i>Created!';
            button.className = button.className.replace('btn-primary', 'bg-green-600 hover:bg-green-700');
            
            // Clear inputs
            nameInput.value = '';
            descriptionInput.value = '';
            iconSelect.value = 'folder';
            
            // Reset button after delay
            setTimeout(() => {
                button.innerHTML = originalText;
                button.className = button.className.replace('bg-green-600 hover:bg-green-700', 'btn-primary');
                button.disabled = false;
            }, 2000);
            
            // Refresh the modal
            setTimeout(() => {
                openFormConfigModal();
            }, 1000);
            
        } catch (error) {
            alert(`Could not create section: ${error.message}`);
            
            // Reset button
            button.innerHTML = '<i class="fas fa-plus mr-1"></i>Create';
            button.disabled = false;
        }
    }

    async function handleEditSection(event) {
        const sectionName = event.target.closest('button').dataset.section;
        const currentSection = currentSections.find(s => 
            (typeof s === 'string' ? s : s.name) === sectionName
        );
        
        const newName = prompt('Enter new section name:', sectionName);
        if (!newName || newName === sectionName) return;
        
        try {
            const response = await fetch(`/api/form/sections/${encodeURIComponent(sectionName)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    name: newName,
                    description: currentSection?.description || '',
                    icon: currentSection?.icon || 'folder'
                })
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to update section');
            }
            
            openFormConfigModal(); // Refresh
            
        } catch (error) {
            alert(`Could not update section: ${error.message}`);
        }
    }

    async function handleDeleteSection(event) {
        const sectionName = event.target.closest('button').dataset.section;
        const fieldCount = getFieldCountForSection(sectionName);
        
        if (fieldCount > 0) {
            alert(`Cannot delete section "${sectionName}" because it contains ${fieldCount} field(s). Please move or delete the fields first.`);
            return;
        }
        
        if (!confirm(`Are you sure you want to delete the section "${sectionName}"?`)) {
            return;
        }
        
        try {
            const response = await fetch(`/api/form/sections/${encodeURIComponent(sectionName)}`, {
                method: 'DELETE'
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to delete section');
            }
            
            openFormConfigModal(); // Refresh
            
        } catch (error) {
            alert(`Could not delete section: ${error.message}`);
        }
    }

    async function handleSaveSectionOrder() {
        const sortableItems = document.querySelectorAll('.sortable-section-item');
        const sectionOrder = Array.from(sortableItems).map(item => item.dataset.sectionName);
        
        if (sectionOrder.length === 0) {
            alert('No sections to reorder.');
            return;
        }
        
        console.log('Saving section order:', sectionOrder);
        console.log('Number of sections to reorder:', sectionOrder.length);
        
        try {
            const button = document.getElementById('save-section-order');
            const originalText = button.innerHTML;
            button.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Saving...';
            button.disabled = true;
            
            const response = await fetch('/api/form/sections/reorder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sections: sectionOrder })
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to reorder sections');
            }
            
            const result = await response.json();
            console.log('Section order saved:', result);
            
            // Show success message
            button.innerHTML = '<i class="fas fa-check mr-2"></i>Saved!';
            button.className = button.className.replace('btn-primary', 'bg-green-600 hover:bg-green-700');
            
            setTimeout(() => {
                button.innerHTML = originalText;
                button.className = button.className.replace('bg-green-600 hover:bg-green-700', 'btn-primary');
                button.disabled = false;
            }, 2000);
            
            // Refresh to show new order
            setTimeout(() => {
                openFormConfigModal();
            }, 1000);
            
        } catch (error) {
            console.error('Error saving section order:', error);
            alert(`Could not save section order: ${error.message}`);
            
            // Reset button
            const button = document.getElementById('save-section-order');
            button.innerHTML = '<i class="fas fa-save mr-2"></i>Save Section Order';
            button.disabled = false;
        }
    }

    function initializeSectionDragAndDrop() {
        const sortableContainer = document.getElementById('sortable-sections');
        if (!sortableContainer) {
            console.warn('sortable-sections container not found');
            return;
        }
        
        console.log('Initializing section drag and drop');
        
        // Remove existing event listeners to prevent duplicates
        sortableContainer.removeEventListener('dragstart', handleSectionDragStart);
        sortableContainer.removeEventListener('dragover', handleSectionDragOver);
        sortableContainer.removeEventListener('drop', handleSectionDrop);
        sortableContainer.removeEventListener('dragend', handleSectionDragEnd);
        
        // Add event listeners using delegation
        sortableContainer.addEventListener('dragstart', handleSectionDragStart);
        sortableContainer.addEventListener('dragover', handleSectionDragOver);
        sortableContainer.addEventListener('drop', handleSectionDrop);
        sortableContainer.addEventListener('dragend', handleSectionDragEnd);
        
        // Verify draggable items
        const draggableItems = sortableContainer.querySelectorAll('.sortable-section-item');
        console.log(`Found ${draggableItems.length} draggable section items`);
    }
    
    function handleSectionDragStart(e) {
        const item = e.target.closest('.sortable-section-item');
        if (!item) return;
        
        console.log('Section drag started:', item.dataset.sectionName);
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', item.dataset.sectionName);
    }
    
    function handleSectionDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        
        const container = e.currentTarget;
        container.classList.add('drag-over');
        
        const draggedElement = document.querySelector('.sortable-section-item.dragging');
        if (!draggedElement) return;
        
        const afterElement = getSectionAfterElement(container, e.clientY);
        
        if (afterElement == null) {
            container.appendChild(draggedElement);
        } else {
            container.insertBefore(draggedElement, afterElement);
        }
        
        // Update order numbers immediately
        updateSectionOrderNumbers();
    }
    
    function handleSectionDrop(e) {
        e.preventDefault();
        const container = e.currentTarget;
        container.classList.remove('drag-over');
        console.log('Section drop completed');
    }
    
    function handleSectionDragEnd(e) {
        const item = e.target.closest('.sortable-section-item');
        if (item) {
            item.classList.remove('dragging');
        }
        
        // Remove drag-over class from all containers
        document.querySelectorAll('#sortable-sections').forEach(container => {
            container.classList.remove('drag-over');
        });
        
        // Final update of order numbers
        updateSectionOrderNumbers();
        console.log('Section drag ended');
    }
    
    function getSectionAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('.sortable-section-item:not(.dragging)')];
        
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }
    
    function updateSectionOrderNumbers() {
        const sortableContainer = document.getElementById('sortable-sections');
        if (!sortableContainer) return;
        
        const items = sortableContainer.querySelectorAll('.sortable-section-item');
        items.forEach((item, index) => {
            const orderSpan = item.querySelector('.section-order-number');
            if (orderSpan) {
                orderSpan.textContent = `#${index + 1}`;
            }
        });
    }

    function toggleOptionsContainer() {
        const typeSelect = document.getElementById('new-field-type');
        const optionsContainer = document.getElementById('options-container');
        const showOptions = ['select', 'radio', 'checkbox'].includes(typeSelect.value);
        optionsContainer.classList.toggle('hidden', !showOptions);
    }

    function toggleEditOptionsContainer() {
        const typeSelect = document.getElementById('edit-field-type');
        const optionsContainer = document.getElementById('edit-options-container');
        const showOptions = ['select', 'radio', 'checkbox'].includes(typeSelect.value);
        optionsContainer.classList.toggle('hidden', !showOptions);
    }

    function initializeFormConfigTabs() {
        const tabs = document.querySelectorAll('.form-config-tab');
        const contents = document.querySelectorAll('.tab-content');

        // Set default active tab if none is active
        const activeTab = document.querySelector('.form-config-tab.active');
        if (!activeTab && tabs.length > 0) {
            tabs[0].classList.add('active');
            // Show the first tab content
            const firstTabId = tabs[0].id.replace('tab-', 'tab-content-');
            const firstContent = document.getElementById(firstTabId);
            if (firstContent) {
                firstContent.classList.remove('hidden');
                firstContent.style.opacity = '1';
            }
        }

        tabs.forEach(tab => {
            tab.addEventListener('click', (e) => {
                e.preventDefault();
                console.log('Tab clicked:', tab.id);
                
                // Prevent multiple rapid clicks
                if (tab.classList.contains('switching')) return;
                tab.classList.add('switching');
                
                // Remove active class from all tabs
                tabs.forEach(t => {
                    t.classList.remove('active');
                });

                // Add active class to clicked tab
                tab.classList.add('active');

                // Hide all tab contents with smooth animation
                contents.forEach(content => {
                    content.style.transition = 'opacity 0.2s ease-in-out';
                    content.style.opacity = '0';
                    setTimeout(() => {
                        content.classList.add('hidden');
                    }, 200);
                });

                // Show corresponding content with smooth animation
                const tabId = tab.id.replace('tab-', 'tab-content-');
                const targetContent = document.getElementById(tabId);
                console.log('Switching to tab content:', tabId);
                
                if (targetContent) {
                    setTimeout(() => {
                        targetContent.classList.remove('hidden');
                        targetContent.style.transition = 'opacity 0.3s ease-in-out';
                        targetContent.style.opacity = '0';
                        
                        requestAnimationFrame(() => {
                            targetContent.style.opacity = '1';
                            
                            // Initialize drag and drop when sections tab is shown
                            if (tabId === 'tab-content-sections') {
                                console.log('Sections tab activated, initializing drag and drop');
                                setTimeout(() => {
                                    initializeSectionDragAndDrop();
                                    initializeDragAndDrop();
                                }, 300);
                            }
                            
                            // Remove switching class after transition
                            setTimeout(() => {
                                tab.classList.remove('switching');
                            }, 400);
                        });
                    }, 250);
                }
            });
        });
    }
    
    function downloadCSV() {
        if (!currentTableData || currentTableData.length === 0) {
            alert("No data available to download.");
            return;
        }

        const selectedColumns = Array.from(document.querySelectorAll('#column-selector-options input:checked')).map(cb => cb.value);
        const headers = selectedColumns.length > 0 ? selectedColumns : Object.keys(currentTableData[0]);
        
        const formatCell = (cell) => {
            let cellString = String(cell === null || cell === undefined ? '' : cell);
            if (cellString.search(/("|,|\n)/g) >= 0) {
                cellString = `"${cellString.replace(/"/g, '""')}"`;
            }
            return cellString;
        };

        const csvContent = [
            headers.join(','),
            ...currentTableData.map(row => headers.map(header => formatCell(row[header])).join(','))
        ].join('\n');
        
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", "recruitment_data.csv");
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    function initializeEventListeners() {
        // --- Modal Handling ---
        const setupModal = (modalId, openBtnId, ...closeBtnIds) => {
            const modal = document.getElementById(modalId);
            const openBtn = document.getElementById(openBtnId);
            if (!modal) return;
            if (openBtn) {
                let openAction = () => modal.classList.remove('hidden');
                if (modalId === 'user-management-modal') openAction = openUserManagementModal;
                if (modalId === 'form-config-modal') openAction = openFormConfigModal;
                openBtn.addEventListener('click', openAction);
            }
            closeBtnIds.forEach(closeBtnId => {
                const closeBtn = document.getElementById(closeBtnId);
                if (closeBtn) {
                    closeBtn.addEventListener('click', () => {
                        modal.classList.add('hidden');
                        if (modalId === 'status-modal' || modalId === 'form-config-modal') {
                            fetchDataAndRender(); // Refresh data on close
                        }
                    });
                }
            });
        };

        setupModal('details-modal', null, 'close-details-modal-btn', 'close-details-modal-btn-2');
        setupModal('status-modal', 'status-management-btn', 'close-status-modal-btn', 'close-status-modal-btn-2');
        setupModal('user-management-modal', 'user-management-btn', 'close-user-modal-btn', 'close-user-modal-btn-2');
        setupModal('form-config-modal', 'form-config-btn', 'close-form-config-modal-btn', 'close-form-config-modal-btn-2');
        setupModal('field-edit-modal', null, 'close-field-edit-modal-btn', 'close-field-edit-modal-btn-2');

        // --- Other Event Listeners ---
        document.querySelectorAll('.filter-select').forEach(sel => sel.addEventListener('change', fetchDataAndRender));
        
        document.getElementById('reset-filters-btn').addEventListener('click', () => {
            document.querySelectorAll('.filter-select').forEach(sel => {
                if (sel.type === 'date') sel.value = '';
                else sel.value = 'all';
            });
            fetchDataAndRender();
        });

        document.querySelectorAll('.collapsible-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                this.nextElementSibling.classList.toggle('hidden');
                this.querySelector('svg').classList.toggle('rotate-180');
            });
        });

        document.getElementById('add-viewer-form')?.addEventListener('submit', handleAddViewer);
        document.getElementById('add-field-form')?.addEventListener('submit', handleAddField);

        // Form configuration event listeners
        document.getElementById('new-field-type')?.addEventListener('change', toggleOptionsContainer);
        document.getElementById('edit-field-type')?.addEventListener('change', toggleEditOptionsContainer);
        document.getElementById('save-field-edit')?.addEventListener('click', handleSaveFieldEdit);
        document.getElementById('save-field-order')?.addEventListener('click', handleSaveFieldOrder);
        
        // Initialize form config tabs
        initializeFormConfigTabs();
        
        // Add refresh functionality
        document.getElementById('refresh-fields')?.addEventListener('click', () => {
            openFormConfigModal();
        });

        // Add section management event listeners
        document.getElementById('create-section-btn')?.addEventListener('click', handleCreateSection);
        document.getElementById('save-section-order')?.addEventListener('click', handleSaveSectionOrder);
        
        // Add debug buttons for manual drag and drop initialization
        document.getElementById('init-section-drag')?.addEventListener('click', () => {
            console.log('Manual section drag initialization triggered');
            initializeSectionDragAndDrop();
        });
        document.getElementById('init-field-drag')?.addEventListener('click', () => {
            console.log('Manual field drag initialization triggered');
            initializeDragAndDrop();
        });
        
        // Add keyboard support for section creation
        document.getElementById('new-section-name')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleCreateSection();
            }
        });
        
        document.getElementById('new-section-description')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleCreateSection();
            }
        });

        const columnSelectorBtn = document.getElementById('column-selector-btn');
        const columnSelectorDropdown = document.getElementById('column-selector-dropdown');
        columnSelectorBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            columnSelectorDropdown.classList.toggle('hidden');
        });
        window.addEventListener('click', () => columnSelectorDropdown?.classList.add('hidden'));

        document.getElementById('download-csv-btn').addEventListener('click', downloadCSV);
    }

    // --- Initial Load ---
    initializeEventListeners();
    
    // Ensure DOM is fully loaded and layout is stable before initializing charts
    setTimeout(() => {
        fetchDataAndRender();
    }, 100);
});