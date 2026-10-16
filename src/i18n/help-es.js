// Texts of the Features screen in Spanish. Spread into es.js; the keys match help-en.js.
export const helpEs = {
  'nav-help': 'Funciones',
  'help-subtitle': 'Qué puede hacer WE Budget y cómo usarlo',
  'help-intro': 'Todo lo que puede hacer la app, en un solo lugar. Haz clic en una fila para leer más; el botón al final de la descripción te lleva al lugar adecuado.',
  'help-search-placeholder': 'Buscar, por ejemplo "sobre"',
  'help-filter-all': 'Todo',
  'help-filter-new': 'Novedades',
  'help-found': 'Encontrado: {n}',
  'help-none': 'No se encontró nada. Prueba otra palabra.',
  'help-badge-new': 'nuevo',
  'help-badge-desktop': 'en el ordenador',
  'help-badge-phone': 'en el teléfono',
  'help-open': 'Abrir: {screen}',
  'help-hint': 'Las nuevas funciones se describen en Funciones',
  'help-hint-close': 'No volver a mostrar',
  'help-phone-row-hint': 'Qué puede hacer la app y cómo usarla',
  'help-tab-today': 'Hoy',
  'help-tab-accounts': 'Cuentas',
  'help-tab-more': 'Más',

  'help-group-start': 'Primeros pasos',
  'help-group-plan': 'El plan',
  'help-group-money': 'Entradas y salidas',
  'help-group-accounts': 'Cuentas y sobres',
  'help-group-recurring': 'Recurrentes',
  'help-group-control': 'Planificación y control',
  'help-group-analytics': 'Analítica',
  'help-group-goals': 'Metas y deudas',
  'help-group-safety': 'Sincronización y seguridad',
  'help-group-phone': 'Teléfono y recordatorios',

  // Getting started
  'help-first-steps-title': 'Primer inicio',
  'help-first-steps-short': 'Empezar de cero, iniciar sesión con Google, abrir un archivo o ver la demo',
  'help-first-steps-body': `En el primer inicio la app ofrece cuatro formas de empezar:

- Empezar de cero: añade tus cuentas y lo que tienen ahora mismo. Los saldos se cuentan desde este día.
- Iniciar sesión con Google: si ya llevas el presupuesto en otro ordenador, llega desde la nube.
- Ya tengo un archivo: una copia de seguridad de WE Budget o el resultado de importar una hoja de cálculo.
- Echar un vistazo primero: un presupuesto inventado para probarlo todo sin riesgo.

Elimina la demo más tarde en Configuración, Datos, con Eliminar todo. La app guarda una copia antes de eliminar.`,

  'help-daily-routine-title': 'Una rutina típica',
  'help-daily-routine-short': 'Sobres, pagos recurrentes, reparto de ingresos, marcar y conciliar',
  'help-daily-routine-body': `El presupuesto funciona mejor así:

1. Añade sobres a tus cuentas (Cuentas y sobres, el icono de carpeta de una cuenta), por ejemplo Facturas o Supermercado.
2. Añade tus pagos e ingresos recurrentes en la pantalla Recurrentes. Los próximos meses se rellenan solos.
3. Cuando llegue un ingreso, márcalo como realizado. La app ofrece repartirlo: confirma y el dinero para los próximos pagos queda reservado.
4. Marca los pagos como realizados a medida que salen: el círculo de la fila, o Space en la fila seleccionada.
5. Anota gastos menores o ingresos imprevistos con Registro rápido (Cmd+N en macOS, Ctrl+N en Windows).
6. De vez en cuando pulsa Conciliar con el banco en la pantalla Cuentas y escribe lo que muestra el banco.

Consejo: marca los pagos cada par de días y la cifra Libre siempre dirá la verdad.`,

  'help-language-theme-title': 'Idioma y tema',
  'help-language-theme-short': 'Catorce idiomas, oscuro o claro',
  'help-language-theme-body': `La app habla catorce idiomas: ruso, ucraniano, inglés, alemán, español, eslovaco, checo, francés, portugués, chino, hindi, bengalí, árabe y urdu. El árabe y el urdu se escriben de derecha a izquierda, y toda la interfaz se refleja para ellos. En el primer inicio la app toma el idioma del sistema si lo tiene; si no, el inglés. El tema es oscuro o claro.

Cámbialos en Configuración, Apariencia: Idioma y Tema. En el teléfono está lo mismo en la pestaña Más.

La elección se guarda con el presupuesto y pasa a tus otros dispositivos con la sincronización.`,

  // The plan
  'help-payment-calendar-title': 'Calendario de pagos',
  'help-payment-calendar-short': 'Cada mes como una lista de pagos e ingresos con su estado',
  'help-payment-calendar-body': `La pantalla Mes muestra todos los pagos e ingresos del mes por fecha. Se ve lo que está previsto, lo que tiene dinero reservado y lo que ya ha ocurrido.

Las flechas de la cabecera cambian de mes; el botón Movimiento añade uno nuevo. Los pagos que aún esperan dinero están resaltados. Las filas realizadas se pliegan en una sola línea Realizados; Mostrar la abre.

Arriba hay un filtro de cuentas y Mostrar cancelados. Las tarjetas sobre la lista muestran el saldo inicial, los ingresos, los gastos, el dinero reservado y lo que queda al final del mes.

Consejo: haz doble clic en una fila para editarla.`,

  'help-statuses-title': 'Estados: previsto, reservado, realizado, cancelado',
  'help-statuses-short': 'Qué significa cada estado y cómo cambiarlo',
  'help-statuses-body': `Cada movimiento tiene uno de cuatro estados:

- Previsto: en el plan, todavía sin dinero reservado. Estos gastos están resaltados.
- Reservado: el dinero ya está en el sobre adecuado. Sigue en el plan y ya no cuenta como libre.
- Realizado: el dinero ya ha salido o ha entrado de verdad.
- Cancelado: omitido esta vez; no cuenta en ningún sitio.

El círculo al inicio de la fila lo marca como realizado, la hucha reserva el dinero. Cancela un movimiento para este mes en su ventana o seleccionando varias filas.

Marcar como realizado un pago con fecha posterior lo mueve a hoy. Cualquier cambio se puede revertir con Deshacer en el mensaje de abajo.`,

  'help-balance-column-title': 'La columna de saldo',
  'help-balance-column-short': 'Lo que queda en la cuenta de la fila después de cada pago',
  'help-balance-column-body': `En la pantalla Mes, la columna Saldo de la cuenta muestra el dinero en la cuenta de esa fila después de ella, así ves enseguida dónde una cuenta quedaría por debajo de cero.

La fila de totales de abajo muestra el resultado del mes en todas las cuentas, como la tarjeta Fin del mes.

Consejo: elige una cuenta en el filtro y la columna se lee como el extracto de esa cuenta.`,

  'help-bulk-actions-title': 'Acciones en bloque',
  'help-bulk-actions-short': 'Marcar como realizado, reservar, mover o cambiar la cuenta de muchas filas a la vez',
  'help-bulk-actions-body': `Selecciona varias filas en la pantalla Mes y aparece una barra abajo: Realizado, Reservar, Al plan, Cancelar, Fecha, Cuenta, Repartir, Añadir etiqueta y Quitar etiqueta.

La barra suma los pagos seleccionados por cuenta, útil para ver cuánto sale de cada tarjeta.

Shift y clic en una casilla selecciona un rango, X selecciona una fila, Cmd/Ctrl+A selecciona todas las filas del mes, Esc quita la selección. Fecha pone una misma fecha o desplaza todas unos días. Cualquier acción se puede deshacer desde el mensaje de abajo.`,

  'help-keyboard-title': 'Teclado',
  'help-keyboard-short': 'Trabaja con el mes y cambia de pantalla sin ratón',
  'help-keyboard-body': `Casi todo se puede hacer con el teclado:

- Cmd/Ctrl+N: registro rápido; Shift+Cmd/Ctrl+N: nuevo movimiento.
- Cmd/Ctrl+1 a 9: las secciones en el orden del menú.
- Cmd/Ctrl+F: búsqueda.
- Arriba, Abajo: filas del mes; Izquierda, Derecha: meses.
- Space: marcar la fila como realizada, R: reservar el dinero, X: seleccionar la fila.
- Enter: editar la fila, Delete: eliminarla.
- En el calendario del mes las flechas se mueven entre días, Enter abre el día, N añade un movimiento en ese día.

Las teclas aparecen al pie de la pantalla Mes. En Windows pulsa Ctrl en lugar de Cmd.`,

  'help-month-calendar-title': 'El mes como calendario',
  'help-month-calendar-short': 'El mismo mes por semanas, con arrastrar y soltar',
  'help-month-calendar-body': `El selector Lista / Calendario de la pantalla Mes muestra el mes por semanas de lunes a domingo. Cada día muestra hasta tres movimientos con su estado e importe (ingresos con más, pagos con menos, transferencias con una flecha), "+2 más" cuando hay más, y el total del día.

Haz clic en un día para ver su lista con las acciones habituales: marcar como realizado, reservar, editar. Haz clic en un movimiento para editarlo. Arrastra un movimiento previsto o reservado a otro día para moverlo.

El filtro de cuentas y Mostrar cancelados también funcionan ahí. La app recuerda la elección; el teléfono siempre muestra la lista.`,

  'help-inline-edit-title': 'Importe en la misma fila',
  'help-inline-edit-short': 'Haz clic en un importe para cambiarlo sin abrir la ventana',
  'help-inline-edit-body': `En la pantalla Mes haz clic en un importe, escribe el nuevo y pulsa Enter. Esc lo deja como estaba.

Útil cuando la factura de la luz llega un poco más alta de lo previsto. Si el pago está dividido, las partes se ajustan en proporción.`,

  'help-search-title': 'Búsqueda',
  'help-search-short': 'Encuentra cualquier pago por nombre, nota, categoría o importe',
  'help-search-body': `La búsqueda recorre todo el plan: nombre, nota, categoría, cuenta, etiquetas e importe. Escribe un importe como 12,50, 12.50 o simplemente 12. Mayúsculas y tildes no importan: "kava" encuentra "Káva".

Ábrela con el botón Buscar de la barra lateral o Cmd/Ctrl+F; en el teléfono, con la lupa de arriba. Los filtros la acotan por fechas, tipo, cuenta (sobres incluidos), categoría, etiqueta, estado o solo registros rápidos.

Debajo de los resultados ves los totales de lo encontrado. Haz clic en una fila para editarla.

Consejo: una forma rápida de ver cuánto costó en un año una suscripción o una tienda.`,

  // Money in and out
  'help-quick-entry-title': 'Registro rápido',
  'help-quick-entry-short': 'Un gasto menor o un ingreso imprevisto en un par de segundos',
  'help-quick-entry-body': `El registro rápido es para lo que no estaba previsto: un café, la compra, un reembolso inesperado. Usa el botón Registro rápido de la barra lateral, Cmd/Ctrl+N o el más redondo en el teléfono.

Elige Gasto o Ingreso, escribe el importe, la categoría y, si quieres, para qué fue. Guardar y seguir deja la ventana abierta para el siguiente; Más: etiquetas añade una etiqueta.

Si la categoría tiene un límite mensual, la ventana muestra cuánto queda. Las reglas de categoría rellenan la categoría a partir del texto.`,

  'help-quick-links-title': 'Registro rápido desde un atajo del iPhone, Siri o Wallet',
  'help-quick-links-short': 'Un enlace que abre el registro rápido ya rellenado',
  'help-quick-links-body': `La app web abre el registro rápido cuando se abre con un enlace especial. Ponlo en un botón, llámalo por voz o ejecútalo después de cada pago con tarjeta.

1. En Configuración (en el teléfono, la pestaña Más) busca Registro rápido desde el iPhone y pulsa Copiar enlace.
2. En la app Atajos crea un atajo con la acción Abrir URL y este enlace. Llámalo Gasto y di "Oye Siri, gasto".
3. Para un registro después de cada pago: Atajos, Automatización, Transacción, tus tarjetas de Wallet, Ejecutar inmediatamente, y pon las variables Importe y Comercio en el enlace.

No se guarda nada hasta que tocas Guardar. El enlace se abre en Safari, así que inicia sesión en Google también ahí, o el registro no llegará al presupuesto común.`,

  'help-allocation-title': 'Repartir los ingresos en sobres',
  'help-allocation-short': 'Cuánto mover a cada sobre hasta el próximo ingreso',
  'help-allocation-body': `Cuando llega el sueldo, la app ofrece repartirlo: calcula cuánto mover a cada sobre para cubrir los pagos hasta la fecha que elijas y marca esos pagos como reservados.

La ventana se abre desde el mensaje que aparece al marcar un ingreso como realizado, y con el botón Repartir del resumen y de la pantalla Cuentas. Elige desde dónde, los pagos hasta qué fecha, y marca los que quieras. La línea de abajo muestra lo que queda libre o lo que falta.

Si no alcanza para todo, desmarca lo que pueda esperar.`,

  'help-split-payments-title': 'Pagos divididos',
  'help-split-payments-short': 'Un tique, varias categorías',
  'help-split-payments-body': `Un tique del supermercado de 60€ puede ser 40€ de comida, 12€ de hogar y 8€ para los niños. Para eso sirve dividir.

En la ventana del pago pulsa Dividir y escribe las partes con sus categorías. La ventana muestra lo que falta por dividir y guarda cuando las partes cuadran.

Los saldos siguen viendo un solo pago, mientras que los totales por categoría, los límites, los avisos y la analítica cuentan cada parte en su categoría. La fila muestra "Supermercado +2" con las partes en una descripción emergente. Cuando cambia el importe (en la fila, al marcarlo como realizado o desde un extracto), las partes se ajustan en proporción.`,

  'help-tags-title': 'Etiquetas y presupuestos de viaje',
  'help-tags-short': 'Agrupa gastos de varias categorías: un viaje, una reforma, un proyecto',
  'help-tags-body': `Una etiqueta agrupa pagos de distintas categorías, como "Fin de semana en Viena" o "Reforma". Añádela en las ventanas del pago, del pago recurrente y del registro rápido.

Una etiqueta puede tener color, presupuesto y fechas. Créalas y edítalas en Configuración, Etiquetas y viajes. La analítica muestra una tarjeta por etiqueta: lo gastado, lo que aún está previsto, cuánto del presupuesto se ha usado y en qué.

Mes y la búsqueda filtran por etiqueta, y a las filas seleccionadas se les añade o quita una etiqueta de una vez. Una etiqueta eliminada se quita de todos los movimientos.`,

  'help-pass-through-title': 'Dinero de paso',
  'help-pass-through-short': 'Dinero de otros que solo pasa por tu cuenta',
  'help-pass-through-body': `A veces alguien te envía dinero para que pagues una factura por él. No es ni tu ingreso ni tu gasto.

Marca De paso en la ventana del movimiento. Ese dinero sigue visible en la cuenta, pero queda fuera de los ingresos, los gastos y la analítica, y el patrimonio neto no lo cuenta.`,

  'help-category-rules-title': 'Reglas de categoría',
  'help-category-rules-short': '"LIDL DEKUJE ZA NAKUP 1234" se convierte solo en "Lidl" en Supermercado',
  'help-category-rules-body': `Una regla dice: cuando el texto del pago contiene estas palabras, usa esta categoría. Las reglas funcionan en el registro rápido y en la importación de extractos.

Están en Configuración, Reglas de categoría, con el botón Nueva regla. Indica el texto, dónde buscar y cómo comparar, y si quieres el tipo y un rango de importes. Una regla también puede dar un nombre legible en lugar del del banco y enviar el pago a un sobre.

Las reglas se comprueban de arriba abajo y gana la primera que encaja; Subir y Bajar cambian el orden. Probar un texto muestra qué regla se aplicaría. En la importación de extractos, Siempre para crea una regla con un clic.`,

  'help-bank-import-title': 'Importar extractos bancarios',
  'help-bank-import-short': 'Carga un CSV del banco y compara cada fila con el plan',
  'help-bank-import-body': `La importación te ahorra marcar a mano: el extracto marca como realizados los pagos previstos y añade los gastos nuevos.

1. En la pantalla Cuentas y sobres pulsa Importar extracto (o el icono de importación de una cuenta), elige la cuenta y un archivo CSV de tu banca online.
2. Revolut y la mayoría de los bancos se reconocen por el nombre de las columnas. Si no, elige tú las columnas de fecha, importe y descripción; la app las recuerda para esa cuenta.
3. Revisa cada fila: Coincide con el plan, Ya registrado, Nuevo u Omitir. Puedes cambiar la acción, asociar una fila a otro pago o ponerle categoría.
4. Pulsa Aplicar.

Un pago previsto del mismo importe dentro de 5 días (10% para importes aproximados) se marca como realizado con el importe y la fecha del banco. Importar dos veces el mismo archivo no añade nada, y un clic deshace toda la importación. Si el archivo tiene una columna de saldo, la app la compara con el suyo.`,

  'help-reconcile-title': 'Conciliar con el banco',
  'help-reconcile-short': 'Escribe lo que muestra el banco y ve la diferencia',
  'help-reconcile-body': `Conciliar mantiene los saldos fieles. En la pantalla Cuentas y sobres pulsa Conciliar con el banco y escribe cuánto tiene cada cuenta según el banco.

Donde una cifra no coincide, la diferencia pasa a ser un ajuste en ese día, y los saldos, el fin del mes y la previsión se recalculan. Los campos vacíos no cambian nada.

Antes de conciliar, marca los pagos que el banco ya ha hecho. Si no, cuentan dos veces; la ventana avisa de ellos.`,

  // Accounts and envelopes
  'help-envelopes-title': 'Sobres',
  'help-envelopes-short': 'Subcuentas, como los espacios de una app bancaria',
  'help-envelopes-body': `Un sobre es una parte del dinero de una cuenta con su propio fin, como Facturas o Vacaciones dentro de la tarjeta principal.

En la pantalla Cuentas y sobres pulsa la carpeta con un más de una cuenta (Añadir un sobre). Un pago va a un sobre mediante el campo Cuenta de su ventana.

El dinero reservado en un sobre pertenece a sus pagos y nunca cuenta como libre para otra cosa. Haz doble clic en la fila de una cuenta para abrir su configuración.`,

  'help-free-money-title': 'Dinero libre',
  'help-free-money-short': 'Cuánto puedes gastar de verdad',
  'help-free-money-body': `Libre es todo lo que hay en tus cuentas menos lo reservado para pagos y el dinero de las metas. Es la cifra principal de la app: puedes gastarlo sin tocar el plan.

Está en el resumen, por cuenta y sobre en la pantalla Cuentas, y en la pestaña Hoy del teléfono, con lo reservado y el total de las cuentas al lado.

Dinero libre por debajo de cero significa que hay más reservado que dinero. Es momento de conciliar las cuentas con el banco o revisar el plan.`,

  'help-set-aside-title': 'Reservar dinero',
  'help-set-aside-short': 'Guarda dinero para un pago hasta que sale',
  'help-set-aside-body': `Reservar significa: este dinero ya es para este pago. Sigue en la cuenta, pero ya no cuenta como libre.

Pulsa la hucha en la fila del pago, o R en la fila seleccionada. Repartir un ingreso reserva dinero para muchos pagos a la vez.

El dinero reservado para un pago nunca cubre otro, por eso la previsión muestra con honestidad dónde faltará dinero.`,

  'help-goal-money-title': 'Dinero bloqueado para metas',
  'help-goal-money-short': 'El dinero ahorrado para una meta no cuenta como libre',
  'help-goal-money-body': `El dinero en la cuenta o el sobre de una meta activa queda bloqueado para ella: no cuenta como libre y no se gasta en los pagos del día a día.

En el resumen, la tarjeta Reservado lo muestra aparte: para pagos y para metas. Una transferencia a la cuenta de una meta reduce el dinero libre, pero no es un gasto.

Cuando una meta se archiva, el dinero de su sobre vuelve a ser libre.`,

  'help-tracking-start-title': 'Inicio del seguimiento',
  'help-tracking-start-short': 'El día desde el que se cuentan los saldos de las cuentas',
  'help-tracking-start-body': `El inicio del seguimiento es el día desde el que se cuentan los saldos de las cuentas. Lo anterior es historial: aparece en los meses y en la analítica, pero no cambia los saldos.

Se fija en el primer inicio y se cambia en Configuración, Contabilidad, Inicio del seguimiento. El saldo inicial de cada cuenta corresponde a ese día.

El cambio afecta a todos los saldos, así que la app pregunta antes, y el cambio se puede deshacer.`,

  'help-adjustments-title': 'Ajustes',
  'help-adjustments-short': 'La diferencia de una conciliación, visible en el mes',
  'help-adjustments-body': `Un ajuste aparece cuando una conciliación con el banco encuentra una diferencia. Es un movimiento normal marcado como ajuste, así la diferencia ni se pierde ni se oculta.

Los ajustes aparecen con las filas realizadas y se suman en la tarjeta del mes. En la analítica, plan frente a realidad los muestra aparte.

Muchos ajustes suelen indicar pequeñas compras olvidadas: conviene anotarlas con el registro rápido.`,

  'help-net-worth-title': 'Patrimonio neto',
  'help-net-worth-short': 'Lo que tiene el hogar menos lo que debe',
  'help-net-worth-body': `El patrimonio neto suma todas las cuentas (sobres incluidos, sin el dinero de paso), los bienes y las inversiones y el dinero que te deben, y resta lo que queda de préstamos y deudas.

La pantalla Cuentas y sobres tiene un bloque Bienes e inversiones: añade una vivienda, un coche, una cuenta de inversión o ahorros que tengas en otro sitio. Pulsa Actualizar el valor de vez en cuando; cuenta el último valor. Cuando vendas algo, usa Archivar (vendido), y el pasado queda como estaba.

La tarjeta Patrimonio neto de la analítica muestra el total, el cambio en el periodo, las cuatro partes y una línea con los cierres de mes. En el teléfono, el total cierra la pestaña Cuentas.`,

  // Recurring
  'help-recurring-title': 'Pagos recurrentes',
  'help-recurring-short': 'Alquiler, sueldo, suscripciones: el plan de los próximos meses se construye solo',
  'help-recurring-body': `Un pago recurrente describe lo que se repite: cada mes, cada varios meses, cada año, ciertos días de la semana o una vez. El plan de los próximos meses se construye con ellos.

En la pantalla Recurrentes pulsa Pago recurrente. Indica el importe, la cuenta, la categoría, el día del mes y cada cuánto se repite. Para importes que varían, marca El importe es aproximado, pedir el exacto al marcarlo como realizado.

Al editar uno, Aplicar los cambios a los movimientos futuros actualiza lo que está por venir. Los movimientos pasados y realizados nunca cambian. Cuántos meses abarca el plan se fija en Configuración, Contabilidad, Horizonte del plan.`,

  'help-every-n-months-title': 'Cada varios meses',
  'help-every-n-months-short': 'Un pago cada 2, 3 o 6 meses, con filas a cero entre medias',
  'help-every-n-months-body': `El agua cada dos meses o un seguro dos veces al año: elige Cada varios meses y rellena Cada cuántos meses.

Mostrarlo también en los otros meses, con importe cero pone una fila a cero en los meses intermedios. El pago no se olvida, y cuando llegue una factura, basta con escribir su importe en la fila.`,

  'help-save-ahead-title': 'Ahorrar por adelantado',
  'help-save-ahead-short': 'Aparta dinero cada mes para pagos anuales y poco frecuentes',
  'help-save-ahead-body': `El seguro anual del coche no debería ser una sorpresa. Ahorrar por adelantado lo convierte en aportaciones mensuales.

1. En la ventana del pago recurrente marca Ahorrar por adelantado para este pago, o pulsa la hucha en su fila de la pantalla Recurrentes.
2. Elige dónde ahorrar (una cuenta de ahorro o un sobre), de dónde sale el dinero y qué día.
3. La app crea una meta para la próxima fecha del pago con una aportación mensual.

A partir de entonces el pago se hace desde ese sobre, donde su dinero queda bloqueado para él. La fila muestra "ahorrado 180€ de 420€, 60€ al mes". Cuando el pago se marca como realizado, la meta pasa a la siguiente fecha. Dejar de ahorrar por adelantado, o eliminar el pago, archiva la meta y devuelve el pago a su cuenta anterior.`,

  'help-recurring-overview-title': 'Resumen de gastos recurrentes',
  'help-recurring-overview-short': 'Lo que cuestan al año las suscripciones y facturas y cómo cambiaron los precios',
  'help-recurring-overview-body': `El selector Todos / Resumen de la pantalla Recurrentes ordena los gastos recurrentes por lo que cuestan al año.

De cada uno ves el importe al mes (un pago anual cuenta una doceava parte, uno cada N meses una enésima parte, los semanales 52 veces al año), al año, el próximo cargo y la evolución del precio según los pagos marcados como realizados, como "antes 9,99€, ahora 12,99€, +30%". Los totales están abajo y un filtro de categorías arriba.

Consejo: míralo una vez por trimestre; es la forma más rápida de encontrar una suscripción olvidada.`,

  // Planning and control
  'help-overview-title': 'Resumen',
  'help-overview-short': 'Dinero libre, movimientos vencidos, hoy y la próxima semana',
  'help-overview-body': `El resumen responde a "cómo vamos ahora mismo". Arriba hay cuatro tarjetas: Libre, Reservado, En las cuentas y Fin del mes, que es lo que queda libre si todo sale según el plan.

Debajo están los movimientos vencidos, los pagos de hoy y de los próximos 7 días, la previsión, el plan de este mes y la tabla de cuentas y sobres. Cuando algo requiere atención, aparece una tarjeta Atención.

En el teléfono, lo mismo aparece de forma breve en la pestaña Hoy.`,

  'help-forecast-title': 'Previsión del dinero libre',
  'help-forecast-short': 'Un gráfico del dinero libre en los próximos meses',
  'help-forecast-body': `El gráfico del resumen muestra cómo cambia el dinero libre día a día si todo sale según el plan: entran los ingresos y salen los pagos sin nada reservado.

Encima del gráfico ves lo que queda al final de la previsión. Hasta dónde llega se fija en Configuración, Contabilidad, Horizonte del plan.

Cuando la línea baja de cero, busca el pago que la hace caer y muévelo o resérvale dinero antes.`,

  'help-first-shortfall-title': 'El primer pago sin dinero suficiente',
  'help-first-shortfall-short': 'Una barra roja en el resumen con el nombre, la fecha y lo que falta',
  'help-first-shortfall-body': `La app recorre el plan hacia delante y encuentra el primer pago que el dinero libre no cubrirá. Una barra roja en el resumen lo nombra, con el importe, la fecha y lo que falta.

El dinero reservado para otros pagos no cuenta aquí: ya está comprometido. Así el aviso llega con tiempo, no el día del pago.

Qué puedes hacer: mover el pago, reducirlo, pasar dinero de un sobre menos urgente o esperar un ingreso.`,

  'help-runway-title': 'Autonomía',
  'help-runway-short': 'Cuántos días dura el dinero libre con tu gasto habitual',
  'help-runway-body': `Bajo la cifra Libre del resumen y del teléfono hay una línea como "Autonomía: 45 días con el gasto habitual". Es el dinero libre dividido entre el gasto medio diario de los últimos 90 días.

Pasa el cursor por encima para ver la media en la que se basa. Sin gastos todavía no hay nada que calcular, y la línea lo dice.

Es una orientación por si un ingreso se retrasa, no una promesa: los pagos grandes y poco frecuentes se suavizan en la media.`,

  'help-alerts-title': 'Avisos',
  'help-alerts-short': 'Un límite casi agotado, poco dinero libre, un pago grande cerca',
  'help-alerts-body': `Una tarjeta Atención aparece en el resumen y en la pestaña Hoy del teléfono cuando:

- una categoría llega al 80% o al 100% de su límite mensual;
- el dinero libre baja de un umbral;
- hay un pago grande en los próximos 3 días.

Actívalos y configúralos en Configuración, Recordatorios: el umbral de dinero libre (100€ por defecto) y lo que cuenta como pago grande (más de 500€). Un campo vacío desactiva ese aviso. En el ordenador cada uno llega también como notificación, como mucho una vez al día.`,

  'help-what-if-title': 'Simulación',
  'help-what-if-short': 'Prueba una compra o un pago nuevo en la previsión sin tocar el plan',
  'help-what-if-body': `La simulación muestra qué pasa con el dinero libre si compras un portátil de 1200€ en diciembre o te apuntas a un gimnasio por 40€ al mes durante seis meses.

Pulsa Simular encima del gráfico de la previsión y añade un borrador: el importe, la fecha, una vez o cada mes y durante cuántos meses. Los borradores activados dibujan una segunda línea discontinua en el gráfico, y el texto de debajo dice dónde el dinero libre está más bajo y si baja de cero.

Los saldos, Mes, los totales, los avisos y los recordatorios nunca ven los borradores. Añadir al plan convierte un borrador en un movimiento (una vez) o en un pago recurrente (cada mes), con opción de deshacer.`,

  'help-limits-title': 'Límites mensuales con traspaso',
  'help-limits-short': 'Cuánto puede gastar una categoría en un mes',
  'help-limits-body': `Una categoría de gastos puede tener un límite mensual. Lo ves en el registro rápido ("Quedan 54€ del límite"), en la analítica y en los avisos.

Fíjalo en Configuración, Categorías, en la columna Límite mensual. Al lado, Al final del mes ofrece:

- Empezar de nuevo: el límite empieza de cero cada mes;
- Pasar lo que sobra: el dinero no gastado se suma al mes siguiente;
- Pasar en ambos sentidos: el exceso de gasto también se descuenta del mes siguiente.

El traspaso empieza en el mes en que se activa la opción. Bajo el límite verás entonces, por ejemplo, "Este mes: 54€ con 14€ del mes anterior".`,

  'help-month-plan-title': 'Plan de este mes',
  'help-month-plan-short': 'Cuánto ha entrado y cuánto ha salido',
  'help-month-plan-body': `La tarjeta Plan de este mes del resumen compara la realidad con el plan: ingresos "1800€ de 2400€, faltan por llegar 600€", gastos "900€ de 1500€, faltan por pagar 600€".

Cuando los gastos superan el plan, la tarjeta lo dice y resalta la línea. Los gastos menores aparecen en una línea aparte.

Consejo: a mitad de mes es la forma más rápida de ver si vas bien.`,

  // Analytics
  'help-analytics-months-title': 'Ingresos y gastos por mes',
  'help-analytics-months-short': 'Un gráfico de los meses y los totales del periodo',
  'help-analytics-months-body': `La pantalla Analítica empieza con los totales del periodo: ingresos, gastos, el resultado y el gasto medio al mes, y un gráfico de ingresos y gastos mes a mes.

Elige el periodo arriba, hasta todo el historial. Solo cuenta lo realizado, gastos menores incluidos, sin el dinero de paso.

La analítica aparece cuando hay ingresos y gastos marcados como realizados.`,

  'help-analytics-categories-title': 'Gastos por categoría',
  'help-analytics-categories-short': 'A dónde va el dinero y cuánto de media',
  'help-analytics-categories-body': `La tabla Gastos por categoría muestra cuánto fue a cada categoría en el periodo, su parte y las medias de 3, 6 y 12 meses.

Las partes de los pagos divididos cuentan en sus propias categorías. Las medias son una buena base para los límites mensuales.`,

  'help-income-sources-title': 'Ingresos por fuente',
  'help-income-sources-short': 'De dónde viene el dinero',
  'help-income-sources-body': `La tabla Ingresos por fuente de la analítica divide los ingresos del periodo por categoría de ingreso: sueldo, trabajos extra, reembolsos, etc., cada una con su parte.

Una fuente es una categoría de ingreso, así que ponla también en los registros rápidos de ingresos.`,

  'help-plan-fact-title': 'Plan frente a realidad',
  'help-plan-fact-short': 'Lo que pensabas gastar y lo que gastaste',
  'help-plan-fact-body': `La tabla Plan y realidad de los gastos compara, mes a mes, los pagos previstos con lo que ocurrió de verdad y muestra la diferencia.

El plan son los pagos previstos del mes sin los gastos menores; lo real es todo lo realizado, gastos menores incluidos. Los ajustes de las conciliaciones tienen su propia columna. Debajo, Límites muestra cómo van los límites de las categorías este mes.`,

  'help-money-flow-title': 'Flujo de dinero',
  'help-money-flow-short': 'Un diagrama de dónde vino el dinero y a dónde fue',
  'help-money-flow-body': `La tarjeta Flujo de dinero de la analítica dibuja los flujos: las fuentes de ingresos a la izquierda fluyen hacia Ingresos, que salen hacia las mayores categorías de gasto (el resto agrupado en Otros) y hacia lo ahorrado. Cuando salió más de lo que entró, aparece un flujo De los ahorros.

Elige Mes pasado, Este mes o Todo el periodo. Pasa el cursor por una banda para ver el importe y la parte.

Bajo el diagrama se dice lo mismo en texto, y Ver como tabla abre una tabla. En ventanas estrechas aparece una lista de dos columnas.`,

  'help-tag-analytics-title': 'Etiquetas y viajes en la analítica',
  'help-tag-analytics-short': 'Una tarjeta por etiqueta: gastado, previsto, presupuesto',
  'help-tag-analytics-body': `La parte Etiquetas y viajes de la analítica tiene una tarjeta por etiqueta: lo gastado, lo que aún está previsto, cuánto del presupuesto se ha usado y el gasto por categoría dentro de la etiqueta.

La barra muestra lo gastado y, más claro, lo previsto. Los reembolsos se cuentan aparte. Útil después de unas vacaciones: ves enseguida cuánto costaron.`,

  // Goals and debts
  'help-goals-title': 'Metas',
  'help-goals-short': 'Un importe, un sobre y una fecha: cuánto ahorrar al mes',
  'help-goals-body': `Una meta une un importe al sobre donde ahorras y a una fecha. La app muestra cuánto hay, cuánto falta y cuánto apartar al mes.

En la pantalla Metas pulsa Nueva meta y rellena Cuánto, Cuenta o sobre y Para cuándo. Lo ahorrado es el saldo de ese sobre.

Añadir una aportación al plan pone en el plan una transferencia mensual a la cuenta de la meta hasta la fecha; aparece en Mes, en los recordatorios y en la previsión. Cuando el plan no llega, la meta lo dice y sube la aportación con un clic.`,

  'help-debts-title': 'Deudas y préstamos',
  'help-debts-short': 'Lo que queda, lo pagado y cuándo termina',
  'help-debts-body': `La pantalla Deudas y préstamos lleva un préstamo del coche, una hipoteca o el dinero que te debe un amigo. Cada una muestra lo que queda, una barra como "38% pagado", la cuota mensual, el tipo, cuándo se liquida con la cuota actual y cuántos intereses quedan por pagar.

1. Pulsa Nueva deuda, elige La pago yo o Me deben, escribe el importe, el tipo y la cuota.
2. Crear un pago recurrente pone la cuota en el plan. Los pagos cuentan cuando están realizados: movimientos marcados con la deuda en el campo Deuda y los movimientos de su pago recurrente.
3. Actualizar saldo toma el importe del extracto del banco como nuevo punto de partida.

El Plan de amortización muestra qué consigue el dinero extra al mes: el orden de pago (primero el tipo más alto o primero la más pequeña), cuándo termina cada una y cuántos meses e intereses se ahorran. En el teléfono, la pestaña Cuentas muestra las deudas.`,

  // Sync and safety
  'help-sync-title': 'Inicio de sesión con Google y sincronización',
  'help-sync-short': 'Un mismo presupuesto en cada ordenador y en el teléfono',
  'help-sync-body': `Inicia sesión con Google en Configuración, Sincronización (en el teléfono, la pestaña Más), y el presupuesto será el mismo donde inicies sesión con esa cuenta.

El presupuesto es un archivo en una carpeta oculta de la app en tu Google Drive que otras apps no pueden ver. Al iniciar y mientras está abierta, la app solo recibe cambios; envía los suyos al cerrar la ventana, al salir y con Sincronizar ahora.

Cuando las dos copias cambiaron, se combinan registro a registro y no se pierde nada. Sin conexión todo sigue funcionando y se sube más tarde.`,

  'help-encryption-title': 'Cifrado del archivo de Drive',
  'help-encryption-short': 'Nadie lee la copia de Drive sin tu contraseña',
  'help-encryption-body': `Configuración, Sincronización, Cifrar el archivo en Google Drive cifra la copia de tu Drive con una contraseña que tú eliges. Google, o quien entre en tu Drive, solo ve bytes cifrados.

Cada dispositivo pide la contraseña una vez. El ordenador guarda la clave (nunca la contraseña) en el llavero del sistema, el teléfono en el almacenamiento del navegador. Un dispositivo sin la contraseña pausa la sincronización y no toca el archivo. En el mismo lugar se cambia la contraseña o se hace que un dispositivo la olvide.

Importante: una contraseña olvidada no se puede recuperar. Nadie podrá abrir ya la copia de Drive, y solo quedarán los presupuestos de tus dispositivos. El cifrado no protege el presupuesto en los propios dispositivos.`,

  'help-backups-title': 'Copias de seguridad y restauración',
  'help-backups-short': 'Una copia cada día y una copia manual en un archivo',
  'help-backups-body': `La app de escritorio guarda una copia del presupuesto cada día (las últimas 14) y otra aparte antes de sustituir el presupuesto entero.

En Configuración, Datos:

- Copia de seguridad, Descargar: todo el presupuesto en un archivo;
- Restaurar una copia: sustituir el presupuesto por un archivo (antes se guarda una copia, y la restauración se puede deshacer);
- Copias automáticas, Abrir: abrir la carpeta con las copias diarias.

Una restauración es un cambio como cualquier otro y llega a tus otros dispositivos con la sincronización.`,

  'help-journal-title': 'Historial de cambios',
  'help-journal-short': 'Qué cambió en 90 días, y deshacer cualquier paso',
  'help-journal-body': `El historial muestra lo que cambió en este dispositivo en los últimos 90 días, día a día. Cada línea es un paso: un clic, una acción en bloque, una importación, una sincronización, con su hora, de dónde vino y un texto breve como Pago "Alquiler" 950€: importe 900€ → 950€.

Ábrelo en Configuración, Datos, Historial de cambios (en el teléfono, la pestaña Más). Filtra por tipo de registro y origen, o busca.

Deshacer este cambio revierte un paso entero; Restaurar esta versión recupera un registro. Antes, la app muestra qué cambiará y avisa si un registro se volvió a cambiar después. El historial se queda en el dispositivo y no se sincroniza.`,

  'help-csv-export-title': 'Exportar a CSV',
  'help-csv-export-short': 'Todos los movimientos en una tabla para Excel o Google Sheets',
  'help-csv-export-body': `Configuración, Datos, Hoja de cálculo CSV, Exportar guarda todos los movimientos en un archivo: fecha, nombre, tipo, importe, cuenta, categoría, estado, nota y etiquetas.

Un pago dividido sale como una línea por parte, marcadas 1/3, 2/3, 3/3, para que cuadren los totales por categoría.`,

  'help-demo-title': 'Presupuesto de demostración',
  'help-demo-short': 'Un hogar inventado para probarlo todo sin riesgo',
  'help-demo-body': `La demo es un hogar inventado con medio año de presupuesto: cuentas, sobres, pagos recurrentes, metas, deudas. Un buen lugar para probar cualquier función.

Se abre en el primer inicio (Echar un vistazo primero) o en Configuración, Datos, Datos de demostración, Ver la demo. La demo sustituye el presupuesto actual; antes se guarda una copia, y la sustitución se puede deshacer.

Cuando termines, Eliminar todo en la misma sección te deja empezar de cero.`,

  // Phone and reminders
  'help-phone-app-title': 'La app del teléfono',
  'help-phone-app-short': 'Los pagos de hoy, marcarlos y registros rápidos en el bolsillo',
  'help-phone-app-body': `En el teléfono WE Budget se abre en el navegador y funciona junto con el ordenador: pagos de hoy y vencidos, marcarlos, búsqueda, registros rápidos de gastos e ingresos, saldos, deudas y patrimonio neto.

1. Abre jaffarsk24.github.io/WE-Budget/app en Safari en el iPhone, o en Chrome en Android.
2. Toca Compartir y luego Añadir a pantalla de inicio (Chrome: el menú y luego Añadir a pantalla de inicio).
3. Abre WE Budget desde la pantalla de inicio e inicia sesión con la misma cuenta de Google que en el ordenador.

El plan, los pagos recurrentes y las cuentas se editan en el ordenador. El presupuesto se queda en el teléfono y funciona sin conexión.`,

  'help-reminders-title': 'Recordatorios en Google Calendar',
  'help-reminders-short': 'Un recordatorio de los pagos sin marcar llega a tu teléfono',
  'help-reminders-body': `En Configuración, Recordatorios, elige la hora (23:00 por defecto) y activa Recordarme con Google Calendar.

La app crea su propio calendario, "WE Budget", en tu cuenta de Google y pone un evento con recordatorio en cada día que aún tiene pagos sin marcar. El recordatorio lo envía Google, así que llega a tu teléfono aunque todos los ordenadores estén apagados.

La app no puede ver tus otros calendarios, y al desactivar los recordatorios se elimina su calendario.`,

  'help-notifications-title': 'Notificaciones de escritorio y resumen matinal',
  'help-notifications-short': 'Una notificación en el ordenador a tu hora y a las 8:00',
  'help-notifications-body': `Mientras la app de escritorio está abierta, puede mostrar una notificación de los pagos sin marcar a la hora del recordatorio, y un resumen matinal de los pagos del día a las 8:00.

Actívalas en Configuración, Recordatorios: Notificación en este ordenador y Resumen matinal. Los avisos de límites y pagos grandes también llegan como notificaciones, como mucho una vez al día.`,

  'help-menu-bar-title': 'Barra de menús',
  'help-menu-bar-short': 'El dinero libre junto al reloj, con registro rápido',
  'help-menu-bar-body': `En el Mac la app muestra el dinero libre junto a un icono en la barra de menús; en Windows, en el área de notificación. Su menú tiene un registro rápido.

Actívalo o desactívalo en Configuración, Apariencia, Mostrar el dinero libre en la barra de menús.`,

  'help-updates-title': 'Actualizaciones',
  'help-updates-short': 'Las nuevas versiones se ofrecen en la propia app',
  'help-updates-body': `Al iniciar, la app busca una versión nueva. Si la hay, un aviso ofrece Actualizar y Novedades.

La app descarga la versión para tu sistema, la verifica, se sustituye a sí misma y vuelve a arrancar. Antes de cerrarse, envía a Google Drive los cambios pendientes.

Para buscar a mano, usa Configuración, Actualizaciones, Buscar actualizaciones.`
};
