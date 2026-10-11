var cDynamicContext = require('./classes/DynamicContext');
var cDOMAdapter = require('./classes/DOMAdapter');
var cException = require('./classes/Exception');
var cExpression = require('./classes/Expression');
var cStaticContext = require('./classes/StaticContext');
var cStringCollator = require('./classes/StringCollator');

// "load" functions
require('./functions');
// "load" operators
require('./operators');
// "load" datatypes
require('./types');

var cObject = global.Object;
var cTypeError = global.TypeError;
var cArray = global.Array;

var oDefaultStaticContext	= new cStaticContext;
var oDefaultDOMAdapter		= new cDOMAdapter;

/**
 * Compiles expression using static context
 */
function fCompile(sExpression, oStaticContext) {
    if (!(typeof sExpression == "string")) {
        throw new cTypeError("Missing or inappropriate type of the expression parameter. String required.");
    }
    if (!(oStaticContext instanceof cStaticContext)) {
        throw new cTypeError("Missing or inappropriate type of the static context parameter. StaticContext type required.");
    }
	return new cExpression(sExpression, oStaticContext);
};

/**
 * Executes expression using dynamic context
 */
function fExecute(oExpression, oDynamicContext) {
    if (!(oExpression instanceof cExpression)) {
        throw new cTypeError("Missing or inappropriate type of the expression parameter. Expression type required.");
    }
    if (!(oDynamicContext instanceof cDynamicContext)) {
        throw new cTypeError("Missing or inappropriate type of the dynamic context parameter. DynamicContext type required.");
    }

	var oSequence	= oExpression.evaluate(oDynamicContext),
		aReturn		= [];

	// Convert types from XML Schema to JavaScript
	for (var nIndex = 0, nLength = oSequence.length, oItem; nIndex < nLength; nIndex++)
		aReturn[aReturn.length]	= oDynamicContext.DOMAdapter.isNode(oItem = oSequence[nIndex]) ? oItem : cDynamicContext.xs2js(oItem);
	//
	return aReturn;
};

/**
 *
 */
function fEvaluate(sExpression, vItem, vStaticContext, oScope, oDOMAdapter) {
    if (!(typeof sExpression == "string")) {
        throw new cTypeError("Missing or inappropriate type of the expression parameter");
    }
    var oStaticContext = typeof vStaticContext == "function" ? new cStaticContext(vStaticContext) : vStaticContext;
    var oDynamicContext = fCreateDynamicContext(oStaticContext, vItem, oScope, oDOMAdapter);
    var oExpression = fCompile(sExpression, oDynamicContext.staticContext);
    return fExecute(oExpression, oDynamicContext);
}

/**
 * Creates static context object
 */
function fCreateStaticContext(vResolver, sBaseURI) {
    return new cStaticContext(vResolver, sBaseURI);
};

/**
 * One value of the caller's scope, in the form the evaluator works with.
 *
 * A SEQUENCE IS CONVERTED ITEM BY ITEM, and that is the whole of this function.
 * A caller binding a variable to several nodes hands over an array, and the
 * single-value conversion below answered it with js2xs(array) — i.e. one
 * XSString holding "[object Element],[object Element]". So a variable bound to a
 * node-set arrived as a string whatever the caller put in, and no reading of it
 * downstream could recover the nodes.
 *
 * A node passes through untouched, and anything else becomes its XML Schema
 * value — unchanged behaviour for every scalar.
 */
function fConvertScopeValue(vValue, oDOMAdapter) {
	if (vValue instanceof cArray) {
		var aOut	= [];
		for (var nIndex = 0, nLength = vValue.length, vItem; nIndex < nLength; nIndex++) {
			vItem	= vValue[nIndex];
			if (vItem == null)
				continue;
			aOut[aOut.length]	= oDOMAdapter.isNode(vItem) ? vItem : cDynamicContext.js2xs(vItem);
		}
		return aOut;
	}
	return oDOMAdapter.isNode(vValue) ? vValue : cDynamicContext.js2xs(vValue);
}

/**
 * Creates dynamic context object
 */
function fCreateDynamicContext(oStaticContext, vItem, oScope, oDOMAdapter) {
	//
	if (!oStaticContext)
		oStaticContext	= oDefaultStaticContext;

	if (typeof vItem == "undefined")
		vItem	= null;

	//
	if (!oDOMAdapter)
		oDOMAdapter		= oDefaultDOMAdapter;

    // Convert types from JavaScript to XML Schema
	var oXSScope	= {},
		oValue;
	if (typeof oScope == "object")
		for (var sKey in oScope) {
			oValue	= oScope[sKey];
			if (cObject.hasOwnProperty.call(oScope, sKey) && oValue != null)
				oXSScope[sKey]	= fConvertScopeValue(oValue, oDOMAdapter);
		}

	// Create dynamic context
	return new cDynamicContext(oStaticContext, vItem == null || oDOMAdapter.isNode(vItem) ? vItem : cDynamicContext.js2xs(vItem), oXSScope, oDOMAdapter);
};

//
module.exports = {
    compile: fCompile,
    execute: fExecute,
	evaluate: fEvaluate,
	createStaticContext: fCreateStaticContext,
	createDynamicContext: fCreateDynamicContext,
	defaultDOMAdapter: oDefaultDOMAdapter,
	defaultStaticContext: oDefaultStaticContext,
	// Classes
	Exception: cException,
	Expression: cExpression,
	DynamicContext: cDynamicContext,
	DOMAdapter: cDOMAdapter,
	StaticContext: cStaticContext,
	StringCollator: cStringCollator
};
