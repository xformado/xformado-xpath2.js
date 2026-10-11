var cException = require('./../../classes/Exception');

var cArray	= global.Array;

function cVarRef(sPrefix, sLocalName, sNameSpaceURI) {
	this.prefix			= sPrefix;
	this.localName		= sLocalName;
	this.namespaceURI	= sNameSpaceURI;
};

cVarRef.prototype.prefix		= null;
cVarRef.prototype.localName		= null;
cVarRef.prototype.namespaceURI	= null;

// Public members
cVarRef.prototype.evaluate	= function (oContext) {
	var sUri	= (this.namespaceURI ? '{' + this.namespaceURI + '}' : '') + this.localName;
	if (oContext.scope.hasOwnProperty(sUri)) {
		var vValue	= oContext.scope[sUri];
		// A VARIABLE MAY BE BOUND TO A SEQUENCE, and this used to wrap whatever
		// it found in a one-item sequence unconditionally.
		//
		// XPath 2.0 → Expressions → Primary Expressions → Variable References:
		// "a variable reference evaluates to the value to which the variable is
		// bound" — and a value in the data model is a sequence of zero or more
		// items, not one item. Every variable bound to more than one node was
		// therefore read back as a single item holding an array, so count($v)
		// over three nodes answered 1, $v/step was refused as "the result of a
		// step … contains an atomic value", and a path binding written through a
		// variable selected nothing at all.
		//
		// An item that is not already a sequence is still wrapped, which is what
		// keeps every single-valued variable reading exactly as before.
		return vValue instanceof cArray ? vValue : [vValue];
	}
	//
	throw new cException("XPST0008"
//->Debug
			, "Variable $" + (this.prefix ? this.prefix + ':' : '') + this.localName + " has not been declared"
//<-Debug
	);
};

//
module.exports = cVarRef;
