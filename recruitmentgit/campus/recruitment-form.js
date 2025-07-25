// Global state variables
let formConfig = {};
let validationRules = {};
let currentStep = 0;
let totalSteps = 0;
let completedFields = new Set();

/**
 * Main initialization function.
 * Executes when the DOM is fully loaded.
 */
document.addEventListener('DOMContentLoaded', () => {
    const userName = sessionStorage.getItem('recruitmentUserName');
    const userEmail = sessionStorage.getItem('recruitmentUserEmail');
    if (userName && userEmail) {
        loadFormConfiguration();
    } else {
        alert('You must create a profile to access this page.');
        window.location.href = 'login.html';
    }
});


/**
 * Fetches the form configuration from the server and renders the form.
 */
async function loadFormConfiguration() {
    try {
        showLoadingState();
        // Fetch form configuration from a remote endpoint.
        const response = await fetch('http://127.0.0.1:5201/api/public/form-config');
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        formConfig = await response.json();
        totalSteps = Object.keys(formConfig).length;
        
        renderDynamicForm();
        setupProgressTracking();
        
        // Populate user details after form is rendered.
        populateUserDetails();
        
        // Show the form *before* trying to load saved data into it.
        showFormState();
        
        // --- Persistence Integration ---
        // Now that the form is visible and structured, load saved data.
        loadFormData();
        // Attach the listener that saves data on input.
        const form = document.getElementById('recruitment-form');
        if (form) {
            form.addEventListener('input', debounce(saveFormData));
        }
        // --- End Persistence Integration ---

        // Add entrance animation for a smooth appearance.
        setTimeout(() => {
            document.querySelectorAll('.form-section').forEach((section, index) => {
                setTimeout(() => {
                    section.classList.add('entered');
                }, index * 150);
            });
        }, 100);
        
    } catch (error) {
        console.error('Error loading form configuration:', error);
        showErrorState(error.message);
    }
}

// --- UI STATE MANAGEMENT ---

/**
 * Shows the loading spinner and hides other states.
 */
function showLoadingState() {
    document.getElementById('loading-state').classList.remove('hidden');
    document.getElementById('error-state').classList.add('hidden');
    document.getElementById('recruitment-form').classList.add('hidden');
    document.getElementById('progress-container').classList.add('hidden');
}

/**
 * Shows an error message and hides other states.
 * @param {string} message - The error message to display.
 */
function showErrorState(message) {
    document.getElementById('loading-state').classList.add('hidden');
    document.getElementById('error-state').classList.remove('hidden');
    document.getElementById('recruitment-form').classList.add('hidden');
    document.getElementById('progress-container').classList.add('hidden');
    document.getElementById('error-message-text').textContent = message;
}

/**
 * Shows the main form and progress bar.
 */
function showFormState() {
    document.getElementById('loading-state').classList.add('hidden');
    document.getElementById('error-state').classList.add('hidden');
    document.getElementById('recruitment-form').classList.remove('hidden');
    document.getElementById('progress-container').classList.remove('hidden');
}

// --- DYNAMIC FORM RENDERING ---

/**
 * Sets up the progress bar and step indicators.
 */
function setupProgressTracking() {
    const stepsContainer = document.getElementById('steps-container');
    stepsContainer.innerHTML = '';
    
    Object.keys(formConfig).forEach((sectionName) => {
        const stepElement = document.createElement('div');
        stepElement.className = 'step-item flex items-center px-3 py-1 rounded-full bg-gray-100 text-sm font-medium';
        stepElement.innerHTML = `
            <i class="fas fa-circle mr-2 text-xs"></i>
            <span>${sectionName}</span>
        `;
        stepsContainer.appendChild(stepElement);
    });
    
    updateProgress();
}

/**
 * Renders the entire form based on the fetched configuration.
 */
function renderDynamicForm() {
    const formSections = document.getElementById('form-sections');
    formSections.innerHTML = '';

    Object.entries(formConfig).forEach(([sectionName, fields], index) => {
        const sectionElement = createFormSection(sectionName, fields, index);
        formSections.appendChild(sectionElement);
    });

    // Add resume upload section if it's not defined in the config.
    if (!formConfig['CV / Resume Upload']) {
        const resumeSection = createResumeSection();
        formSections.appendChild(resumeSection);
    }
}

/**
 * Creates a single section of the form.
 * @param {string} sectionName - The title of the section.
 * @param {Array} fields - An array of field objects for this section.
 * @param {number} index - The index of the section.
 * @returns {HTMLElement} The created section element.
 */
function createFormSection(sectionName, fields, index) {
    const section = document.createElement('div');
    section.className = 'form-section entering bg-gradient-to-br from-white to-gray-50 rounded-2xl p-8 shadow-lg border border-gray-100';
    section.setAttribute('data-section', index);
    
    const header = document.createElement('div');
    header.className = 'flex items-center mb-8 pb-4 border-b border-gray-200';
    header.innerHTML = `
        <div class="flex items-center justify-center w-12 h-12 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl mr-4">
            <i class="fas fa-edit text-white text-lg"></i>
        </div>
        <div>
            <h2 class="section-header text-2xl font-bold">${sectionName}</h2>
            <p class="text-gray-600 mt-1">Please fill in all required fields</p>
        </div>
    `;
    section.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'section-grid grid grid-cols-1 lg:grid-cols-2 gap-8';

    fields.forEach(field => {
        const fieldElement = createFormField(field);
        if (fieldElement) {
            if (field.type === 'textarea') {
                fieldElement.classList.add('lg:col-span-2');
            }
            grid.appendChild(fieldElement);
        }
    });

    section.appendChild(grid);
    return section;
}

/**
 * Creates a container for a single form field.
 * @param {object} field - The field configuration object.
 * @returns {HTMLElement} The created field container element.
 */
function createFormField(field) {
    const fieldContainer = document.createElement('div');
    fieldContainer.className = 'field-container';
    
    // Store validation rules from the config.
    if (field.validations) {
        try {
            validationRules[field.name] = JSON.parse(field.validations);
        } catch (e) {
            console.warn(`Could not parse validation rules for ${field.name}`);
            validationRules[field.name] = {};
        }
    }

    // Handle special field types.
    if (field.type === 'radio') return createRadioField(field, fieldContainer);
    if (field.type === 'checkbox') return createCheckboxField(field, fieldContainer);

    // Create standard field label.
    const label = document.createElement('label');
    label.setAttribute('for', field.name);
    label.className = 'block text-sm font-semibold text-gray-700 mb-3';
    label.innerHTML = `
        <i class="fas fa-${getFieldIcon(field.type)} mr-2 text-indigo-500"></i>
        ${field.label}
        ${field.required ? '<span class="text-red-500 ml-1">*</span>' : ''}
    `;
    fieldContainer.appendChild(label);

    const inputContainer = document.createElement('div');
    inputContainer.className = 'relative';

    let input;
    switch (field.type) {
        case 'select':
            input = createSelectField(field);
            break;
        case 'textarea':
            input = createTextareaField(field);
            break;
        case 'file':
            return createFileField(field, fieldContainer); // File field has a different structure
        default:
            input = createInputField(field);
    }

    if (input) {
        inputContainer.appendChild(input);
        fieldContainer.appendChild(inputContainer);
        
        // Add containers for error and success messages.
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message hidden';
        errorDiv.id = `error-${field.name}`;
        fieldContainer.appendChild(errorDiv);

        const successDiv = document.createElement('div');
        successDiv.className = 'success-message hidden text-green-600 text-sm mt-2';
        successDiv.id = `success-${field.name}`;
        successDiv.innerHTML = '<i class="fas fa-check-circle mr-1"></i>Looks good!';
        fieldContainer.appendChild(successDiv);

        addValidationListeners(input, field);
    }

    return fieldContainer;
}

/**
 * Gets a Font Awesome icon name based on field type.
 * @param {string} type - The field type.
 * @returns {string} The icon name.
 */
function getFieldIcon(type) {
    const icons = {
        'text': 'edit', 'email': 'envelope', 'tel': 'phone',
        'date': 'calendar', 'number': 'hashtag', 'textarea': 'align-left',
        'select': 'list', 'file': 'upload', 'radio': 'dot-circle',
        'checkbox': 'check-square'
    };
    return icons[type] || 'edit';
}


// --- FIELD CREATION HELPERS ---

function createInputField(field) {
    const input = document.createElement('input');
    input.type = field.type;
    input.name = field.name;
    input.id = field.name;
    input.className = 'form-input block w-full px-4 py-4 rounded-xl shadow-sm text-gray-900 placeholder-gray-400';
    input.placeholder = `Enter ${field.label.toLowerCase()}...`;
    
    if (field.required) input.required = true;
    // Make name and email fields read-only as they are pre-populated.
    if (field.name === 'name' || field.name === 'email') {
        input.readOnly = true;
        input.className += ' bg-gray-50 cursor-not-allowed';
    }
    
    return input;
}

function createSelectField(field) {
    const select = document.createElement('select');
    select.name = field.name;
    select.id = field.name;
    select.className = 'form-input block w-full px-4 py-4 rounded-xl shadow-sm text-gray-900';
    
    if (field.required) select.required = true;

    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = `Select ${field.label}`;
    defaultOption.disabled = true;
    defaultOption.selected = true;
    select.appendChild(defaultOption);

    if (field.options) {
        field.options.split(',').forEach(optionText => {
            const optionElement = document.createElement('option');
            const trimmedOption = optionText.trim();
            optionElement.value = trimmedOption;
            optionElement.textContent = trimmedOption;
            select.appendChild(optionElement);
        });
    }

    return select;
}

function createTextareaField(field) {
    const textarea = document.createElement('textarea');
    textarea.name = field.name;
    textarea.id = field.name;
    textarea.className = 'form-input block w-full px-4 py-4 rounded-xl shadow-sm text-gray-900 placeholder-gray-400 resize-none';
    textarea.rows = 4;
    textarea.placeholder = `Enter ${field.label.toLowerCase()}...`;
    
    if (field.required) textarea.required = true;
    
    return textarea;
}

function createRadioField(field, container) {
    const fieldset = document.createElement('div');
    fieldset.className = 'space-y-4';

    const legend = document.createElement('label');
    legend.className = 'block text-sm font-semibold text-gray-700 mb-4';
    legend.innerHTML = `
        <i class="fas fa-dot-circle mr-2 text-indigo-500"></i>
        ${field.label}
        ${field.required ? '<span class="text-red-500 ml-1">*</span>' : ''}
    `;
    fieldset.appendChild(legend);

    const radioContainer = document.createElement('div');
    radioContainer.className = 'grid grid-cols-1 gap-3';

    if (field.options) {
        field.options.split(',').forEach(optionText => {
            const optionDiv = document.createElement('div');
            optionDiv.className = 'radio-option p-4 rounded-xl cursor-pointer';

            const label = document.createElement('label');
            label.className = 'flex items-center cursor-pointer';

            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = field.name;
            radio.value = optionText.trim();
            radio.className = 'h-5 w-5 text-indigo-600 border-2 border-gray-300 focus:ring-indigo-500';
            
            radio.addEventListener('change', function() {
                radioContainer.querySelectorAll('.radio-option').forEach(opt => opt.classList.remove('selected'));
                if (this.checked) {
                    optionDiv.classList.add('selected');
                }
                validateField(radio, field);
            });

            const span = document.createElement('span');
            span.className = 'ml-3 text-gray-900 font-medium';
            span.textContent = optionText.trim();

            label.appendChild(radio);
            label.appendChild(span);
            optionDiv.appendChild(label);
            radioContainer.appendChild(optionDiv);
        });
    }

    fieldset.appendChild(radioContainer);
    container.appendChild(fieldset);
    return container;
}

function createCheckboxField(field, container) {
    const checkboxDiv = document.createElement('div');
    checkboxDiv.className = 'checkbox-option p-4 rounded-xl';

    const label = document.createElement('label');
    label.className = 'flex items-start cursor-pointer';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.name = field.name;
    checkbox.id = field.name;
    checkbox.className = 'h-5 w-5 text-indigo-600 border-2 border-gray-300 rounded focus:ring-indigo-500 mt-0.5';
    if (field.required) checkbox.required = true;

    checkbox.addEventListener('change', function() {
        checkboxDiv.classList.toggle('selected', this.checked);
        validateField(checkbox, field);
    });

    const span = document.createElement('span');
    span.className = 'ml-3 text-gray-900 font-medium';
    span.innerHTML = `
        <i class="fas fa-check-square mr-2 text-indigo-500"></i>
        ${field.label}
        ${field.required ? '<span class="text-red-500 ml-1">*</span>' : ''}
    `;

    label.appendChild(checkbox);
    label.appendChild(span);
    checkboxDiv.appendChild(label);
    container.appendChild(checkboxDiv);
    return container;
}

function createFileField(field, fieldContainer) {
    const label = document.createElement('label');
    label.setAttribute('for', field.name);
    label.className = 'block text-sm font-semibold text-gray-700 mb-3';
    label.innerHTML = `
        <i class="fas fa-upload mr-2 text-indigo-500"></i>
        ${field.label}
        ${field.required ? '<span class="text-red-500 ml-1">*</span>' : ''}
    `;

    const uploadArea = document.createElement('div');
    uploadArea.className = 'file-upload-area p-8 rounded-xl text-center cursor-pointer';
    uploadArea.innerHTML = `
        <div class="mb-4"><i class="fas fa-cloud-upload-alt text-4xl text-gray-400"></i></div>
        <p class="text-lg font-medium text-gray-700 mb-2">Click to upload or drag and drop</p>
        <p class="text-sm text-gray-500">${field.name === 'cv-resume' ? 'PDF format only, max 5MB' : 'Select your file'}</p>
    `;

    const input = document.createElement('input');
    input.type = 'file';
    input.name = field.name;
    input.id = field.name;
    input.className = 'hidden';
    if (field.required) input.required = true;
    if (field.name === 'cv-resume') input.accept = '.pdf';

    const fileInfo = document.createElement('div');
    fileInfo.id = `file-info-${field.name}`;
    fileInfo.className = 'hidden mt-4 p-4 bg-indigo-50 rounded-xl border border-indigo-200';

    uploadArea.addEventListener('click', () => input.click());
    uploadArea.addEventListener('dragover', e => { e.preventDefault(); uploadArea.classList.add('dragover'); });
    uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
    uploadArea.addEventListener('drop', e => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            input.files = e.dataTransfer.files;
            handleFileChange(input, field);
        }
    });

    input.addEventListener('change', () => handleFileChange(input, field));

    fieldContainer.appendChild(label);
    fieldContainer.appendChild(uploadArea);
    fieldContainer.appendChild(input);
    fieldContainer.appendChild(fileInfo);

    return fieldContainer;
}

/**
 * Handles the change event for a file input.
 * @param {HTMLInputElement} input - The file input element.
 * @param {object} field - The field configuration.
 */
function handleFileChange(input, field) {
    const fileInfo = document.getElementById(`file-info-${input.name}`);
    if (input.files.length > 0) {
        const file = input.files[0];
        fileInfo.innerHTML = `
            <div class="flex items-center justify-between">
                <div class="flex items-center">
                    <i class="fas fa-file-pdf text-red-500 text-xl mr-3"></i>
                    <div>
                        <p class="font-medium text-gray-900">${file.name}</p>
                        <p class="text-sm text-gray-600">${(file.size / 1024 / 1024).toFixed(2)} MB</p>
                    </div>
                </div>
                <button type="button" onclick="clearFile('${input.name}')" class="text-red-500 hover:text-red-700">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;
        fileInfo.classList.remove('hidden');
        validateField(input, field);
    } else {
        fileInfo.classList.add('hidden');
        updateProgress();
    }
}

/**
 * Clears the selected file from a file input.
 * @param {string} fieldName - The name of the file input.
 */
function clearFile(fieldName) {
    const input = document.getElementById(fieldName);
    const fileInfo = document.getElementById(`file-info-${fieldName}`);
    input.value = '';
    fileInfo.classList.add('hidden');
    const field = findFieldConfig(fieldName);
    if (field) validateField(input, field);
}

/**
 * Creates the dedicated resume upload section.
 * @returns {HTMLElement} The created section element.
 */
function createResumeSection() {
    const section = document.createElement('div');
    section.className = 'form-section bg-gradient-to-br from-white to-gray-50 rounded-2xl p-8 shadow-lg border border-gray-100';
    
    const header = document.createElement('div');
    header.className = 'flex items-center mb-8 pb-4 border-b border-gray-200';
    header.innerHTML = `
        <div class="flex items-center justify-center w-12 h-12 bg-gradient-to-br from-green-500 to-emerald-600 rounded-xl mr-4">
            <i class="fas fa-file-upload text-white text-lg"></i>
        </div>
        <div>
            <h2 class="section-header text-2xl font-bold">CV / Resume Upload</h2>
            <p class="text-gray-600 mt-1">Upload your latest resume in PDF format</p>
        </div>
    `;
    section.appendChild(header);

    const fieldContainer = createFormField({
        name: 'cv-resume',
        label: 'CV / Resume',
        type: 'file',
        required: true
    });

    section.appendChild(fieldContainer);
    return section;
}


// --- VALIDATION AND PROGRESS ---

/**
 * Adds validation event listeners to an input.
 * @param {HTMLElement} input - The input element.
 * @param {object} field - The field configuration.
 */
function addValidationListeners(input, field) {
    input.addEventListener('blur', () => validateField(input, field));
    input.addEventListener('input', () => {
        // Clear error on input, but don't re-validate immediately.
        clearFieldError(input);
        updateProgress();
    });
    input.addEventListener('change', () => validateField(input, field));
}

/**
 * Validates a single form field based on its rules.
 * @param {HTMLElement} input - The input element to validate.
 * @param {object} field - The field configuration.
 * @returns {boolean} True if the field is valid, false otherwise.
 */
function validateField(input, field) {
    let value = input.value.trim();
    if (input.type === 'checkbox') value = input.checked;
    if (input.type === 'file') value = input.files.length > 0;
    if (input.type === 'radio') {
        const checkedRadio = document.querySelector(`input[name="${field.name}"]:checked`);
        value = !!checkedRadio;
    }

    const rules = validationRules[field.name] || {};
    let isValid = true;
    let errorMessage = '';

    if (field.required && !value) {
        isValid = false;
        errorMessage = `${field.label} is required.`;
    }

    if (isValid && input.value && rules.minLength && input.value.length < rules.minLength) {
        isValid = false;
        errorMessage = `${field.label} must be at least ${rules.minLength} characters.`;
    }

    if (isValid && input.value && rules.maxLength && input.value.length > rules.maxLength) {
        isValid = false;
        errorMessage = `${field.label} must not exceed ${rules.maxLength} characters.`;
    }

    if (isValid && input.value && rules.pattern) {
        if (!new RegExp(rules.pattern).test(input.value)) {
            isValid = false;
            errorMessage = rules.errorMessage || `Invalid ${field.label.toLowerCase()} format.`;
        }
    }

    if (!isValid) {
        showFieldError(input, errorMessage);
        completedFields.delete(field.name);
    } else {
        clearFieldError(input);
        if (value) {
            showFieldSuccess(input);
            completedFields.add(field.name);
        } else {
            completedFields.delete(field.name);
        }
    }

    updateProgress();
    return isValid;
}

function showFieldError(input, message) {
    const fieldContainer = input.closest('.field-container, .checkbox-option, .radio-option');
    if (fieldContainer) fieldContainer.classList.add('field-error');
    input.classList.add('field-error');
    input.classList.remove('field-success');

    const errorDiv = document.getElementById(`error-${input.name}`);
    if (errorDiv) {
        errorDiv.innerHTML = `<i class="fas fa-exclamation-circle mr-1"></i>${message}`;
        errorDiv.classList.remove('hidden');
    }
}

function showFieldSuccess(input) {
    if (input.type !== 'radio' && input.type !== 'checkbox' && !input.value.trim()) return;
    
    const fieldContainer = input.closest('.field-container, .checkbox-option, .radio-option');
    if (fieldContainer) fieldContainer.classList.remove('field-error');
    input.classList.add('field-success');
    input.classList.remove('field-error');

    const successDiv = document.getElementById(`success-${input.name}`);
    if (successDiv) successDiv.classList.remove('hidden');
}


function clearFieldError(input) {
    const fieldContainer = input.closest('.field-container, .checkbox-option, .radio-option');
    if (fieldContainer) fieldContainer.classList.remove('field-error');
    input.classList.remove('field-error');
    
    const errorDiv = document.getElementById(`error-${input.name}`);
    if (errorDiv) errorDiv.classList.add('hidden');
    
    const successDiv = document.getElementById(`success-${input.name}`);
    if (successDiv) successDiv.classList.add('hidden');
}

/**
 * Updates the main progress bar and text.
 */
function updateProgress() {
    const allFields = getAllFormFields();
    const totalFields = allFields.filter(f => f.required).length;
    
    const completedRequiredFields = allFields.filter(f => f.required && completedFields.has(f.name)).length;

    const percentage = totalFields > 0 ? Math.round((completedRequiredFields / totalFields) * 100) : 0;
    
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');
    
    if (progressBar) progressBar.style.width = `${percentage}%`;
    if (progressText) progressText.textContent = `${percentage}% Complete (${completedRequiredFields}/${totalFields} required fields)`;

    updateStepIndicators();
}

/**
 * Updates the visual state of the step indicators.
 */
function updateStepIndicators() {
    const steps = document.querySelectorAll('.step-item');
    const sections = Object.keys(formConfig);
    
    sections.forEach((sectionName, index) => {
        const step = steps[index];
        if (!step) return;
        
        const sectionFields = formConfig[sectionName].filter(f => f.required);
        const sectionCompleted = sectionFields.every(field => completedFields.has(field.name));
        const sectionInProgress = sectionFields.some(field => completedFields.has(field.name));

        step.classList.remove('active', 'completed');
        const icon = step.querySelector('i');
        
        if (sectionCompleted) {
            step.classList.add('completed');
            icon.className = 'fas fa-check-circle mr-2 text-xs';
        } else if (sectionInProgress) {
            step.classList.add('active');
            icon.className = 'fas fa-circle-notch fa-spin mr-2 text-xs';
        } else {
            icon.className = 'fas fa-circle mr-2 text-xs';
        }
    });
}

/**
 * Gathers all field configurations from the global config.
 * @returns {Array} An array of all field objects.
 */
function getAllFormFields() {
    return Object.values(formConfig).flat();
}

/**
 * Populates the name and email fields from session storage.
 */
function populateUserDetails() {
    const userName = sessionStorage.getItem('recruitmentUserName');
    const userEmail = sessionStorage.getItem('recruitmentUserEmail');
    
    const nameInput = document.getElementById('name');
    const emailInput = document.getElementById('email');
    
    if (nameInput && userName) {
        nameInput.value = userName;
        validateField(nameInput, findFieldConfig('name'));
    }
    if (emailInput && userEmail) {
        emailInput.value = userEmail;
        validateField(emailInput, findFieldConfig('email'));
    }
    
    updateProgress();
}

// --- FORM SUBMISSION ---

/**
 * Handles the form submission event.
 */
document.addEventListener('submit', async function(event) {
    if (event.target.id === 'recruitment-form') {
        event.preventDefault();

        let isFormValid = true;
        getAllFormFields().forEach(field => {
            const element = document.getElementById(field.name) || document.querySelector(`[name="${field.name}"]`);
            if (element && !validateField(element, field)) {
                isFormValid = false;
            }
        });

        if (!isFormValid) {
            const firstError = document.querySelector('.field-error');
            if (firstError) {
                firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            showNotification('Please correct the errors before submitting.', 'error');
            return;
        }

        const submitButton = event.target.querySelector('button[type="submit"]');
        const submitText = document.getElementById('submit-text');
        
        submitButton.disabled = true;
        submitText.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Submitting...';

        try {
            const formData = new FormData(event.target);
            const response = await fetch('http://127.0.0.1:5000/api/submit_application', {
                method: 'POST',
                body: formData,
            });

            const result = await response.json();

            if (response.ok) {
                showNotification('Application submitted successfully! Redirecting...', 'success');
                clearSavedFormData();
                sessionStorage.removeItem('recruitmentUserName');
                sessionStorage.removeItem('recruitmentUserEmail');
                setTimeout(() => { window.location.href = 'login.html'; }, 2000);
            } else {
                showNotification(`Error: ${result.error || 'An unknown error occurred.'}`, 'error');
            }
        } catch (error) {
            console.error('Submission Error:', error);
            showNotification('Submission failed. Check your connection.', 'error');
        } finally {
            submitButton.disabled = false;
            submitText.innerHTML = '<i class="fas fa-paper-plane mr-2"></i>Submit Application';
        }
    }
});

/**
 * Displays a notification message on the screen.
 * @param {string} message - The message to display.
 * @param {string} type - 'success', 'error', or 'info'.
 */
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    const typeClasses = {
        success: 'bg-green-500 text-white',
        error: 'bg-red-500 text-white',
        info: 'bg-blue-500 text-white'
    };
    const iconClasses = {
        success: 'fa-check-circle',
        error: 'fa-exclamation-triangle',
        info: 'fa-info-circle'
    };

    notification.className = `fixed top-4 right-4 z-50 p-4 rounded-xl shadow-lg max-w-md transform translate-x-full transition-transform duration-300 ${typeClasses[type]}`;
    notification.innerHTML = `
        <div class="flex items-center">
            <i class="fas ${iconClasses[type]} mr-3"></i>
            <span>${message}</span>
            <button onclick="this.parentElement.parentElement.remove()" class="ml-4 text-white hover:text-gray-200"><i class="fas fa-times"></i></button>
        </div>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => { notification.style.transform = 'translateX(0)'; }, 100);
    setTimeout(() => {
        notification.style.transform = 'translateX(calc(100% + 1rem))';
        setTimeout(() => notification.remove(), 300);
    }, 5000);
}

/**
 * Finds the configuration for a field by its name.
 * @param {string} fieldName - The name of the field.
 * @returns {object|null} The field configuration object or null if not found.
 */
function findFieldConfig(fieldName) {
    return getAllFormFields().find(f => f.name === fieldName) || null;
}


// --- DATA PERSISTENCE (SESSION STORAGE) ---

function getStorageKey() {
    const userEmail = sessionStorage.getItem('recruitmentUserEmail');
    return userEmail ? `recruitmentFormData_${userEmail}` : null;
}

function saveFormData() {
    const key = getStorageKey();
    if (!key) return;

    const form = document.getElementById('recruitment-form');
    const formData = new FormData(form);
    const dataToStore = {};

    for (const [name, value] of formData.entries()) {
        if (!(value instanceof File)) {
            dataToStore[name] = value;
        }
    }
    sessionStorage.setItem(key, JSON.stringify(dataToStore));
}

function loadFormData() {
    const key = getStorageKey();
    if (!key) return;

    const savedData = sessionStorage.getItem(key);
    if (!savedData) return;

    const data = JSON.parse(savedData);
    const form = document.getElementById('recruitment-form');

    for (const name in data) {
        if (name === 'name' || name === 'email') continue;
        
        const element = form.elements[name];
        if (element) {
            if (element instanceof RadioNodeList) {
                 const radioToCheck = Array.from(element).find(r => r.value === data[name]);
                 if(radioToCheck) {
                    radioToCheck.checked = true;
                    radioToCheck.dispatchEvent(new Event('change', { 'bubbles': true }));
                 }
            } else if (element.type === 'checkbox') {
                element.checked = !!data[name];
                element.dispatchEvent(new Event('change', { 'bubbles': true }));
            } else {
                element.value = data[name];
                element.dispatchEvent(new Event('input', { 'bubbles': true }));
                element.dispatchEvent(new Event('blur', { 'bubbles': true }));
            }
        }
    }
    console.log('Form progress restored from session.');
}

function clearSavedFormData() {
    const key = getStorageKey();
    if (key) {
        sessionStorage.removeItem(key);
        console.log('Saved session data cleared.');
    }
}

function debounce(func, delay = 300) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            func.apply(this, args);
        }, delay);
    };
}
