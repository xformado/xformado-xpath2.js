/**
 * Decimal precision and typed evaluation — target behaviour.
 *
 * One case per requirement item. Each case states the typing it runs under,
 * because the same expression has different correct answers under xs:decimal
 * and under xs:double, and swapping the two silently invalidates the case.
 */
var xpath = require('./../../lib');
var expect = require('chai').expect;
var nanodom = require('./../nanodom');

// <invoice><subtotal>129.14</subtotal><taxRate>1.2</taxRate></invoice>
//
// Values reached through a node are untyped, and untyped operands in an
// arithmetic expression are cast to xs:double — XPath 2.0, section
// "Arithmetic Expressions". Writing the same case over literals instead would
// make it a decimal case and would not test this path at all.
var invoice = (function() {
    var doc = nanodom.createDocument();
    var root = nanodom.createElement('invoice');
    nanodom.addChild(doc, root);
    [['subtotal', '129.14'], ['taxRate', '1.2']].forEach(function(pair) {
        var el = nanodom.createElement(pair[0]);
        nanodom.addChild(root, el);
        nanodom.addChild(el, nanodom.createText(pair[1]));
        // nanodom builds no textContent of its own — no other spec atomizes an
        // element — and that is the property atomization reads.
        el.textContent = pair[1];
    });
    return root;
})();

// Two sibling elements <a> and <b> holding the given text, which is the shape
// a comparison between two form fields has. Both are untyped for want of a
// type on the bind.
function pair(sLeft, sRight) {
    var doc = nanodom.createDocument();
    var root = nanodom.createElement('pair');
    nanodom.addChild(doc, root);
    [['a', sLeft], ['b', sRight]].forEach(function(entry) {
        var el = nanodom.createElement(entry[0]);
        nanodom.addChild(root, el);
        nanodom.addChild(el, nanodom.createText(entry[1]));
        el.textContent = entry[1];
    });
    return root;
}

// The written form of the value, which is what a form stores in its instance
// and sends in a submission. fn:string() is the engine's own answer; reading
// evaluate()[0] instead would measure the JavaScript boundary, which is a
// separate concern with its own conversion.
function stringOf(sExpression, oContext) {
    return String(xpath.evaluate('fn:string(' + sExpression + ')', oContext)[0]);
}

function answerOf(sExpression, oContext) {
    return xpath.evaluate(sExpression, oContext)[0];
}

describe("decimal precision", function() {

    // Case 1 — typed by the expression itself: a decimal literal is
    // xs:decimal, an integer literal is xs:integer. Neither side is a double,
    // so the product must be exact.
    //
    // XQuery 1.0 and XPath 2.0 Functions and Operators, section
    // "Operators on Numeric Values": op:numeric-multiply on two xs:decimal
    // operands returns an xs:decimal.
    describe("xs:decimal literal times xs:integer literal", function() {
        it('1.005 * 100 is exactly 100.5', function() {
            expect(stringOf("1.005 * 100"))
                .to.equal("100.5");
        });

        it('does not fall back to binary floating point', function() {
            expect(stringOf("1.005 * 100"))
                .to.not.equal("100.49999999999999");
        });
    });

    // XML Schema Part 2: Datatypes, section "decimal": a conforming processor
    // must support at least 18 decimal digits. An exponent-form result proves
    // the value went through a double on the way.
    describe("decimal range", function() {
        it('keeps 31 significant digits without falling into exponent form', function() {
            expect(stringOf('xs:decimal("123456789012345678901234567890.5")'))
                .to.equal("123456789012345678901234567890.5");
        });

        it('still adds exactly at that width', function() {
            expect(stringOf('xs:decimal("123456789012345678901234567890.5") + 1'))
                .to.equal("123456789012345678901234567891.5");
        });

        it('keeps an integer too large for a double exact', function() {
            expect(stringOf('xs:integer("123456789012345678901")'))
                .to.equal("123456789012345678901");
        });
    });

    // Decided 2026-08-13 and declared in EXTENSIONS.md. The specification
    // leaves the digit count to the implementation — Functions and Operators,
    // section "Operators on Numeric Values" — but not the notation.
    describe("canonical notation", function() {
        it('drops trailing zeros rather than keeping the written scale', function() {
            expect(stringOf("0.10 + 0.20")).to.equal("0.3");
        });

        it('does not grow a fraction on a whole number', function() {
            expect(stringOf("1.0")).to.equal("1");
            expect(stringOf("2")).to.equal("2");
        });

        it('carries a division that does not come out even to 20 places', function() {
            expect(stringOf("100 div 3")).to.equal("33.33333333333333333333");
        });

        it('rounds the last place half away from zero', function() {
            expect(stringOf("2 div 3")).to.equal("0.66666666666666666667");
        });
    });

    // Case 2 — the case the requirement was raised for. Both operands come
    // from the instance, so both are untyped and both are cast to xs:double.
    // Plain IEEE-754 multiplication of those two doubles is exactly 154.968;
    // the digits that appear today are produced by the scaling mitigation, not
    // by the double.
    describe("untyped values from an instance", function() {
        it('129.14 * 1.2 does not leak into the stored value', function() {
            expect(stringOf("subtotal * taxRate", invoice))
                .to.equal("154.968");
        });

        // The total is the case's honest limit and is recorded as such. Under
        // the default typing both operands are doubles, and 129.14 + 154.968
        // is 284.10799999999995 in IEEE-754 — not an artefact of this engine
        // but what the type means. Only an exact type reaches 284.108.
        it('but the total stays binary while the fields are untyped', function() {
            expect(stringOf("subtotal + subtotal * taxRate", invoice))
                .to.equal("284.10799999999995");
        });

        it('and is exact once the values carry a decimal type', function() {
            expect(stringOf("xs:decimal(subtotal) * xs:decimal(taxRate)", invoice))
                .to.equal("154.968");
            expect(stringOf("xs:decimal(subtotal) + xs:decimal(subtotal) * xs:decimal(taxRate)", invoice))
                .to.equal("284.108");
        });
    });

    // Cases 3, 4 and 5 — xs:double is IEEE-754 by definition, so these expect
    // an uglier answer than the engine gives today. XQuery 1.0 and XPath 2.0
    // Functions and Operators, section "Operators on Numeric Values" defers to
    // that definition; hiding the rounding is what the scaling mitigation did,
    // and it is the reason case 2 was wrong.
    describe("xs:double is binary and says so", function() {
        it('0.1 + 0.2 is 0.30000000000000004, not 0.3', function() {
            expect(stringOf('xs:double("0.1") + xs:double("0.2")'))
                .to.equal("0.30000000000000004");
        });

        it('129.14 * 1.2 is exact in binary and must not be perturbed', function() {
            expect(stringOf('xs:double("129.14") * xs:double("1.2")'))
                .to.equal("154.968");
        });

        // An xs:decimal operand against an xs:double is promoted to xs:double
        // — Functions and Operators, section "Operators on Numeric Values".
        // The exact decimal 0.1 becomes the same double the literal 0.1 is.
        it('a decimal promoted to double follows the double', function() {
            expect(stringOf('xs:decimal("0.1") + xs:double("0.2")'))
                .to.equal("0.30000000000000004");
        });

        it('but two decimals stay exact', function() {
            expect(stringOf('xs:decimal("0.1") + xs:decimal("0.2")'))
                .to.equal("0.3");
        });
    });

    // Case 10 — nothing to do with precision. Unary minus wrote the negated
    // value back into its operand, and a variable reference hands out the very
    // object held in scope, so negating $v changed $v for the rest of the
    // expression. Every numeric type is affected equally.
    describe("unary minus leaves its operand alone", function() {
        it('$v * -$v is -100 when $v is 10', function() {
            expect(String(xpath.evaluate("$v * -$v", null, null, {v: 10})[0]))
                .to.equal("-100");
        });

        it('does not change the variable for what follows', function() {
            expect(String(xpath.evaluate("(-$v, $v)", null, null, {v: 10})[1]))
                .to.equal("10");
        });

        it('negates a decimal without disturbing it either', function() {
            expect(String(xpath.evaluate("$v * -$v", null, null, {v: 1.5})[0]))
                .to.equal("-2.25");
        });
    });

    // Functions and Operators, section "Functions on Numeric Values": abs,
    // ceiling, floor and round return the type they were given. They used to
    // return xs:decimal whatever went in, and computed through a double to get
    // there.
    describe("numeric functions keep the type they were given", function() {
        function typeOf(sExpression) {
            return xpath.evaluate('(' + sExpression + ') instance of xs:integer')[0] ? "integer"
                 : xpath.evaluate('(' + sExpression + ') instance of xs:double')[0] ? "double"
                 : xpath.evaluate('(' + sExpression + ') instance of xs:float')[0] ? "float"
                 : "decimal";
        }

        it('an integer argument comes back an integer', function() {
            expect(typeOf("fn:abs(-3)")).to.equal("integer");
            expect(typeOf("fn:round(7)")).to.equal("integer");
        });

        it('a double argument comes back a double', function() {
            expect(typeOf("fn:abs(xs:double(-3.5))")).to.equal("double");
            expect(typeOf("fn:ceiling(xs:double(1.5))")).to.equal("double");
        });

        it('a float argument comes back a float', function() {
            expect(typeOf("fn:abs(xs:float(-3.5))")).to.equal("float");
        });

        it('a decimal argument comes back a decimal', function() {
            expect(typeOf("fn:abs(-3.5)")).to.equal("decimal");
        });

        // A value exactly half way rounds towards positive infinity.
        it('rounds half towards +INF', function() {
            expect(stringOf("fn:round(1.5)")).to.equal("2");
            expect(stringOf("fn:round(-1.5)")).to.equal("-1");
            expect(stringOf("fn:round(2.5)")).to.equal("3");
            expect(stringOf("fn:round(-2.5)")).to.equal("-2");
        });

        it('floors and ceilings negatives the right way', function() {
            expect(stringOf("fn:floor(-1.5)")).to.equal("-2");
            expect(stringOf("fn:ceiling(-1.5)")).to.equal("-1");
        });
    });

    // Functions and Operators, section "fn:sum": with no $zero argument the
    // empty sequence sums to xs:integer(0). It answered xs:double(0).
    describe("fn:sum over the empty sequence", function() {
        it('is an integer zero', function() {
            expect(xpath.evaluate("fn:sum(()) instance of xs:integer")[0])
                .to.equal(true);
        });
    });

    // Durations are tied to xs:decimal — dividing two of them returns one, and
    // multiplying one takes a numeric operand. This is the module most easily
    // forgotten when the numeric types change underneath it.
    describe("durations still work over the exact type", function() {
        it('divides one duration by another', function() {
            expect(stringOf('xs:dayTimeDuration("PT1H") div xs:dayTimeDuration("PT2H")'))
                .to.equal("0.5");
        });

        it('divides a duration by a number', function() {
            expect(stringOf('xs:yearMonthDuration("P2Y11M") div 1.5'))
                .to.equal("P1Y11M");
        });

        it('multiplies a duration by a number', function() {
            expect(stringOf('xs:dayTimeDuration("P1DT2H") * 2'))
                .to.equal("P2DT4H");
        });
    });

    // Case 9 — two number fields with no type on the bind. XPath 2.0, section
    // "General Comparisons" asks for a string comparison when both operands
    // are untyped, and the string "9" sorts after "10", so the form answered
    // that nine is not less than ten.
    //
    // This is a deliberate deviation, declared in EXTENSIONS.md: when both
    // operands are written in canonical decimal notation they are compared as
    // numbers. The engine already made the same call for the mixed case, where
    // an untyped operand is cast to the other side's type.
    describe("two untyped fields that both look like numbers", function() {
        it('9 < 10 is true', function() {
            expect(answerOf("a < b", pair('9', '10'))).to.equal(true);
        });

        it('holds for the value comparison too', function() {
            expect(answerOf("a lt b", pair('9', '10'))).to.equal(true);
        });

        it('9 = 9.0 is true — the same number written two ways', function() {
            expect(answerOf("a = b", pair('9', '9.0'))).to.equal(true);
        });

        // A trailing zero is how money is written, so it must not push the
        // comparison back to text — 9.50 sorts after 10.00 as a string.
        it('a trailing zero does not disqualify: 9.50 < 10.00', function() {
            expect(answerOf("a < b", pair('9.50', '10.00'))).to.equal(true);
        });

        it('and -9.5 equals -9.50', function() {
            expect(answerOf("a = b", pair('-9.5', '-9.50'))).to.equal(true);
        });
    });

    // Case 8 — the guard. It answers false today and must answer false after
    // the change, so it only earns its place if it can bring down an
    // implementation that writes the canonical pattern too widely. Each
    // assertion below is a form some plausible-but-wrong pattern would accept
    // as a number, and each states the answer text comparison gives.
    //
    // The reason the pattern is the canonical form and nothing wider: a data
    // field holding a number does not normally have leading zeros, so a value
    // that has them was formatted by somebody and is a string.
    describe("an untyped value that is not written as a plain number", function() {
        it('00123 = 123 stays false — a leading zero is formatting', function() {
            expect(answerOf("a = b", pair('00123', '123'))).to.equal(false);
        });

        // A pattern that let leading zeros through would compare 123 with 123
        // and answer false here.
        it('and 00123 < 123 is true, because the two sort as text', function() {
            expect(answerOf("a < b", pair('00123', '123'))).to.equal(true);
        });

        it('a leading plus is formatting as well: +5 = 5 is false', function() {
            expect(answerOf("a = b", pair('+5', '5'))).to.equal(false);
        });

        it('so is a missing integer part: .5 = 0.5 is false', function() {
            expect(answerOf("a = b", pair('.5', '0.5'))).to.equal(false);
        });

        it('so is a trailing point: 5. = 5 is false', function() {
            expect(answerOf("a = b", pair('5.', '5'))).to.equal(false);
        });

        it('so is exponent notation: 1e2 = 100 is false', function() {
            expect(answerOf("a = b", pair('1e2', '100'))).to.equal(false);
        });

        it('one side is enough to disqualify: 10 < 9x sorts as text', function() {
            expect(answerOf("a < b", pair('10', '9x'))).to.equal(true);
        });

        it('text that is not a number at all still sorts as text', function() {
            expect(answerOf("a < b", pair('abc', 'abd'))).to.equal(true);
            expect(answerOf("a = b", pair('abc', 'abc'))).to.equal(true);
        });

        it('and an empty field is not a number', function() {
            expect(answerOf("a = b", pair('', '0'))).to.equal(false);
        });
    });

    // Functions and Operators, section "Comparison Operators on Numeric
    // Values": op:numeric-equal and its two siblings compare the values, not
    // the doubles the values happen to round to. They went through valueOf(),
    // so any two decimals sharing a double answered equal.
    describe("comparisons between exact values are exact", function() {
        it('two decimals wider than a double are not equal', function() {
            expect(answerOf('xs:decimal("123456789012345678901234567890.1")'
                    + ' eq xs:decimal("123456789012345678901234567890.2")'))
                .to.equal(false);
        });

        it('and order the right way round', function() {
            expect(answerOf('xs:decimal("123456789012345678901234567890.1")'
                    + ' lt xs:decimal("123456789012345678901234567890.2")'))
                .to.equal(true);
        });

        it('a difference below double resolution still shows', function() {
            expect(answerOf('xs:decimal("0.1") lt xs:decimal("0.10000000000000000001")'))
                .to.equal(true);
        });

        it('integers too large for a double compare exactly', function() {
            expect(answerOf('xs:integer("123456789012345678901") eq xs:integer("123456789012345678902")'))
                .to.equal(false);
        });

        // Promotion still applies: against an xs:double both sides are
        // doubles, and that is what the comparison must see.
        it('but a decimal against a double follows the double', function() {
            expect(answerOf('xs:decimal("0.1") eq xs:double("0.1")')).to.equal(true);
        });
    });

    // Functions and Operators, section "Casting to numeric types": casting to
    // xs:integer truncates towards zero. This path raised a ReferenceError
    // before the type was rewritten, because three identifiers it used were
    // never brought into the file.
    describe("cast to xs:integer from a double", function() {
        it('truncates instead of failing', function() {
            expect(stringOf("xs:integer(xs:double(3.7))")).to.equal("3");
        });

        it('truncates towards zero for negatives', function() {
            expect(stringOf("xs:integer(xs:double(-3.7))")).to.equal("-3");
        });
    });
});
