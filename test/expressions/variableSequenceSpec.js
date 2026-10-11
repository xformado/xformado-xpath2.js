/**
 * A variable reference evaluates to the VALUE the variable is bound to, and a
 * value in the data model is a sequence of zero or more items.
 *
 * XPath 2.0 → Expressions → Primary Expressions → Variable References: "a
 * variable reference evaluates to the value to which the variable is bound".
 * Nothing in that sentence makes it one item, and a caller binding a variable to
 * a node-set is the ordinary case for a host language — a `for` binding, a
 * quantified binding and an XForms variable all do it.
 *
 * ⛔ WHAT IT USED TO DO, in two places that had to be repaired together:
 *   · the reference wrapped whatever it found in a one-item sequence, so an
 *     array in scope came back as ONE item holding an array;
 *   · createDynamicContext converted a scope value with the single-value
 *     conversion, so an array handed in by a caller became one XSString reading
 *     "[object Element],[object Element]" before the reference ever saw it.
 * Repairing either alone leaves the other one answering, which is why the cases
 * below go through BOTH entry points: evaluate() with a scope object, and
 * pushVariable() on a context the caller built.
 *
 * ⭐ Every single-valued case is here too, and deliberately: the change must be
 * invisible to a variable bound to one node, one number or one string, which is
 * what every existing caller does.
 */
var xpath = require('./../../lib');
var expect = require('chai').expect;
var nanodom = require('./../nanodom');

// <items><item><id>7</id></item><item><id>8</id></item><item><id>9</id></item></items>
//
// Three children, so "the first of them" and "all of them" cannot give the same
// answer — one node would make every case below pass for the wrong reason.
var items = (function() {
    var doc = nanodom.createDocument();
    var root = nanodom.createElement('items');
    nanodom.addChild(doc, root);
    ['7', '8', '9'].forEach(function(text) {
        var item = nanodom.createElement('item');
        nanodom.addChild(root, item);
        var id = nanodom.createElement('id');
        nanodom.addChild(item, id);
        nanodom.addChild(id, nanodom.createText(text));
        // nanodom builds no textContent of its own, and that is the property
        // atomization reads.
        id.textContent = text;
    });
    return root;
})();

/** The three <item> elements, as the evaluator itself selects them. */
function three() {
    return xpath.evaluate('item', items);
}

describe("a variable bound to a sequence", function() {

    describe("through the scope argument of evaluate()", function() {

        it('count() answers the length of the sequence, not 1', function() {
            expect(String(xpath.evaluate('fn:count($v)', items, null, { v: three() })[0]))
                .to.equal("3");
        });

        it('a path step through the variable reaches the nodes below it', function() {
            // An atomic value cannot be stepped through at all — XPath 2.0
            // refuses it as "the result of a step (other than the last step) in
            // a path expression contains an atomic value" — so this case says
            // the sequence is still made of NODES and not of their text.
            expect(xpath.evaluate('$v/id', items, null, { v: three() })
                    .map(function(n) { return n.textContent; }))
                .to.have.ordered.members(['7', '8', '9']);
        });

        it('a predicate over the variable selects within the sequence', function() {
            expect(xpath.evaluate('$v[2]/id', items, null, { v: three() })
                    .map(function(n) { return n.textContent; }))
                .to.have.ordered.members(['8']);
        });

        it('the empty sequence is empty and is not one item', function() {
            expect(String(xpath.evaluate('fn:count($v)', items, null, { v: [] })[0]))
                .to.equal("0");
        });

        it('a sequence of atomic values keeps its items', function() {
            expect(String(xpath.evaluate('fn:count($v)', items, null, { v: [1, 2, 3] })[0]))
                .to.equal("3");
            expect(String(xpath.evaluate('fn:sum($v)', items, null, { v: [1, 2, 3] })[0]))
                .to.equal("6");
        });
    });

    describe("through pushVariable() on a context the caller built", function() {

        function pushed(sExpression, vValue) {
            var oContext = xpath.createDynamicContext(null, items, {});
            oContext.pushVariable('v', vValue);
            return xpath.execute(xpath.compile(sExpression, oContext.staticContext), oContext);
        }

        it('count() answers the length of the sequence', function() {
            expect(String(pushed('fn:count($v)', three())[0])).to.equal("3");
        });

        it('a path step through the variable reaches the nodes below it', function() {
            expect(pushed('$v/id', three()).map(function(n) { return n.textContent; }))
                .to.have.ordered.members(['7', '8', '9']);
        });
    });

    // ⭐ The control cases. A variable bound to ONE thing has to read exactly as
    // it did before, and these are the shapes every existing caller uses.
    describe("one value is unchanged", function() {

        it('one node is one item, and still a node', function() {
            var one = xpath.evaluate('item[1]', items);
            expect(String(xpath.evaluate('fn:count($v)', items, null, { v: one[0] })[0]))
                .to.equal("1");
            expect(xpath.evaluate('$v/id', items, null, { v: one[0] })
                    .map(function(n) { return n.textContent; }))
                .to.have.ordered.members(['7']);
        });

        it('a one-item sequence holding a node reads the same way', function() {
            var one = xpath.evaluate('item[1]', items);
            expect(String(xpath.evaluate('fn:count($v)', items, null, { v: one })[0]))
                .to.equal("1");
        });

        it('a number stays a number', function() {
            expect(String(xpath.evaluate('$v * 2', items, null, { v: 10 })[0]))
                .to.equal("20");
        });

        it('a string stays a string', function() {
            expect(String(xpath.evaluate('fn:concat($v, "!")', items, null, { v: 'ok' })[0]))
                .to.equal("ok!");
        });

        it('a boolean stays a boolean', function() {
            expect(String(xpath.evaluate('$v and fn:true()', items, null, { v: true })[0]))
                .to.equal("true");
        });
    });

    it('a name nothing bound is still undeclared', function() {
        // The repair must not turn a missing variable into an empty sequence:
        // XPath 2.0 → Expressions makes an unbound reference the static error
        // XPST0008, and a host language reports the author's typo from it.
        expect(function() { xpath.evaluate('fn:count($niet)', items, null, { v: three() }); })
            .to.throw(/has not been declared/);
    });
});
